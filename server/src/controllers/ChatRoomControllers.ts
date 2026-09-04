import type { Request, Response } from 'express';
import { Prisma, ChatRoomType, ChatMemberRole } from '../generated/prisma/client';
import { prisma } from '../lib/prisma';
import { addChatRoomMembers } from '../lib/ChatMembers';
import { validateCreateChatRoomInput } from './ChatRoomValidators';

const memberInclude = {
  members: {
    include: { member: { select: { id: true, name: true, avatarUrl: true } } },
  },
} as const;

type ChatRoomWithMembers = Prisma.ChatRoomGetPayload<{ include: typeof memberInclude }>;

/**
 * Creates (or reuses) a direct room between the requester and one other
 * user. Both members are admins - a direct room has no name/avatar to
 * protect and no add/remove-member action applies to a 1:1 room.
 */
async function createDirectChatRoom(
  tx: Prisma.TransactionClient,
  requesterId: number,
  otherUserId: number
): Promise<{ room: ChatRoomWithMembers; created: boolean }> {
  // Reuse an existing direct room between these two users instead of
  // creating a duplicate every time someone hits "message" on a friend's
  // profile.
  const existing = await tx.chatRoom.findFirst({
    where: {
      type: ChatRoomType.direct,
      AND: [
        { members: { some: { memberId: requesterId } } },
        { members: { some: { memberId: otherUserId } } },
      ],
    },
    include: memberInclude,
  });
  if (existing) {
    return { room: existing, created: false };
  }

  const newRoom = await tx.chatRoom.create({ data: { type: ChatRoomType.direct } });
  await addChatRoomMembers(tx, newRoom.id, [requesterId, otherUserId], ChatMemberRole.admin);

  const room = await tx.chatRoom.findUniqueOrThrow({
    where: { id: newRoom.id },
    include: memberInclude,
  });
  return { room, created: true };
}

/**
 * Creates a group room. The requester becomes admin; everyone they invite
 * joins as a regular member - the same default role
 * POST /chatrooms/:chatid/members will use.
 */
async function createGroupChatRoom(
  tx: Prisma.TransactionClient,
  requesterId: number,
  memberIds: number[],
  name: string | undefined,
  avatarUrl: string | undefined
): Promise<{ room: ChatRoomWithMembers; created: boolean }> {
  const newRoom = await tx.chatRoom.create({
    data: {
      type: ChatRoomType.group,
      name: name?.trim() ?? null,
      avatarUrl: avatarUrl ?? null,
    },
  });

  await addChatRoomMembers(tx, newRoom.id, [requesterId], ChatMemberRole.admin);
  await addChatRoomMembers(tx, newRoom.id, memberIds, ChatMemberRole.member);

  const room = await tx.chatRoom.findUniqueOrThrow({
    where: { id: newRoom.id },
    include: memberInclude,
  });
  return { room, created: true };
}

export async function createChatRoom(req: Request, res: Response) {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized Access' });
  }
  const requesterId = req.user.id;

  const validation = validateCreateChatRoomInput(req.body, requesterId);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.error });
  }
  const { type, memberIds, name, avatarUrl } = validation;

  try {
    const { room, created } = await prisma.$transaction((tx) =>
      type === 'direct'
        ? createDirectChatRoom(tx, requesterId, memberIds[0]!)
        : createGroupChatRoom(tx, requesterId, memberIds, name, avatarUrl)
    );

    return res.status(created ? 201 : 200).json(room);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
      // One of the member_ids doesn't refer to a real user.
      return res
        .status(400)
        .json({ error: 'one or more member_ids do not refer to an existing user' });
    }
    throw err;
  }
}