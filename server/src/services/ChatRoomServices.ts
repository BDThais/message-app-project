import { addChatRoomMembers } from '../lib/chatMembers';
import { prisma } from '../lib/prisma';
import { Prisma, ChatRoomType, ChatMemberRole } from '../generated/prisma/client';

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
export async function createDirectChatRoom(
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
export async function createGroupChatRoom(
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


// Shape returned to the client for every chat room, regardless of type.
export interface ChatRoomSummary {
  id: number;
  type: 'direct' | 'group';
  name: string | null;
  avatarUrl: string | null;
  createdAt: Date;
  lastMessage: { content: string; createdAt: Date } | null;
}
 
/**
 * Fetch direct chat rooms for a user.
 * Reusable by GET /chatrooms (no chatId) and later by GET /chatrooms/:chatid
 * (pass chatId to scope the query down to a single room).
 * name/avatarUrl come from the *other* member, since direct rooms have
 * no name/avatar of their own.
 */
export async function getDirectChatRoomsForUser(
  userId: number,
  chatId?: number
): Promise<ChatRoomSummary[]> {
  const rooms = await prisma.chatRoom.findMany({
    where: {
      type: 'direct',
      ...(chatId !== undefined ? { id: chatId } : {}),
      members: { some: { memberId: userId } },
    },
    include: {
      members: {
        where: { memberId: { not: userId } },
        include: { member: { select: { name: true, avatarUrl: true } } },
      },
      messages: {
        orderBy: { id: 'desc' },
        take: 1,
        select: { content: true, createdAt: true },
      },
    },
  });
 
  return rooms.map((room) => {
    // otherMember can be missing if they've since left the room (a direct
    // room isn't deleted until it has zero members left, so a lone
    // remaining member can still list it).
    const otherMember = room.members[0]?.member;
    const lastMessage = room.messages[0] ?? null;
 
    return {
      id: room.id,
      type: 'direct',
      name: otherMember?.name ?? null,
      avatarUrl: otherMember?.avatarUrl ?? null,
      createdAt: room.createdAt,
      lastMessage,
    };
  });
}
 
/**
 * Fetch group chat rooms for a user. Same reuse intent as the direct
 * variant above. Group rooms use their own name/avatarUrl fields.
 */
export async function getGroupChatRoomsForUser(
  userId: number,
  chatId?: number
): Promise<ChatRoomSummary[]> {
  const rooms = await prisma.chatRoom.findMany({
    where: {
      type: 'group',
      ...(chatId !== undefined ? { id: chatId } : {}),
      members: { some: { memberId: userId } },
    },
    include: {
      messages: {
        orderBy: { id: 'desc' },
        take: 1,
        select: { content: true, createdAt: true },
      },
    },
  });
 
  return rooms.map((room) => ({
    id: room.id,
    type: 'group',
    name: room.name,
    avatarUrl: room.avatarUrl,
    createdAt: room.createdAt,
    lastMessage: room.messages[0] ?? null,
  }));
}
 
// Most recent activity first: last message time if there is one,
// otherwise the room's creation time.
export function activityTimestamp(room: ChatRoomSummary): number {
  return (room.lastMessage?.createdAt ?? room.createdAt).getTime();
}

export async function updateChatRoomById(
  chatId: number,
  data: { name?: string; avatarUrl?: string | null }
) {
  return prisma.chatRoom.update({
    where: { id: chatId },
    data,
  });
}