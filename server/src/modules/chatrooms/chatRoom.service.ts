import { addChatRoomMembers, memberResponseArgs } from './chatMember.service';
import { findNonFriendIds } from '../friends/friend.service';
import { prisma } from '../../lib/prisma';
import { Prisma, ChatRoomType, ChatMemberRole } from '../../generated/prisma/client';
import type { ChatRoomSummary, RoomType } from '../../contract/types';

// The room's own columns and its members. `emptiedAt` belongs to the cleanup job and stays out of the response.
const roomWithMembersArgs = {
  include: { members: memberResponseArgs },
  omit: { emptiedAt: true },
} as const;

export type ChatRoomWithMembers = Prisma.ChatRoomGetPayload<typeof roomWithMembersArgs>;

export type CreateChatRoomResult =
  | { status: 'ok'; room: ChatRoomWithMembers; created: boolean }
  // Refused: at least one of `memberIds` is not a friend of the requester (or
  // does not exist, which is not told apart). Nothing was created.
  | { status: 'not_friends' };

/**
 * Creates a room, or finds the existing direct room. The invitees' friendships are checked before
 * anything is written, so a refused request creates nothing, and for a direct room before the lookup
 * of an existing room, so a room between two former friends is not handed out again.
 */
export async function createChatRoom(
  type: ChatRoomType,
  requesterId: number,
  memberIds: number[],
  name: string | undefined,
  avatarUrl: string | undefined
): Promise<CreateChatRoomResult> {
  return prisma.$transaction(async (tx) => {
    if ((await findNonFriendIds(tx, requesterId, memberIds)).length > 0) {
      return { status: 'not_friends' } as const;
    }

    const { room, created } =
      type === ChatRoomType.direct
        ? await createDirectChatRoom(tx, requesterId, memberIds[0]!)
        : await createGroupChatRoom(tx, requesterId, memberIds, name, avatarUrl);

    return { status: 'ok', room, created } as const;
  });
}

export async function getChatMembership(memberId: number, chatId: number) {
  return prisma.chatMember.findUnique({
    where: { memberId_chatId: { memberId, chatId } },
    select: { role: true, chatRoom: { select: { type: true } } },
  });
}

export function isForeignKeyConstraintError(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003';
}

/**
 * The key of the advisory lock that serializes the creation of a direct room between two users. The
 * lower id goes in the high half, so (a, b) and (b, a) are one key, and two ids of up to 31 bits
 * fit a bigint without sharing a key with any other pair.
 */
export function directRoomLockKey(userA: number, userB: number): bigint {
  const [low, high] = userA < userB ? [userA, userB] : [userB, userA];
  return (BigInt(low) << 32n) | BigInt(high);
}

/**
 * Both members of a direct room are admins: it has no name or avatar to protect, and no
 * add/remove-member action applies to a 1:1 room.
 */
export async function createDirectChatRoom(
  tx: Prisma.TransactionClient,
  requesterId: number,
  otherUserId: number
): Promise<{ room: ChatRoomWithMembers; created: boolean }> {
  // Nothing in the schema says that a pair of users has one direct room, so the look-up below and the
  // insert after it have to be one step: two simultaneous requests for the same pair would both find
  // nothing and both create a room. The lock lasts until this transaction ends; the second request
  // waits here, then finds the first one's room. An advisory lock rather than one on the user rows:
  // those are taken by account deletion and the mailed-link flows, and a lock on the pair cannot
  // take part in a cycle with them.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${directRoomLockKey(requesterId, otherUserId)})`;

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
    ...roomWithMembersArgs,
  });
  if (existing) {
    return { room: existing, created: false };
  }

  const newRoom = await tx.chatRoom.create({ data: { type: ChatRoomType.direct } });
  await addChatRoomMembers(tx, newRoom.id, [requesterId, otherUserId], ChatMemberRole.admin);

  const room = await tx.chatRoom.findUniqueOrThrow({
    where: { id: newRoom.id },
    ...roomWithMembersArgs,
  });
  return { room, created: true };
}

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
    ...roomWithMembersArgs,
  });
  return { room, created: true };
}

/**
 * What the service hands over for every chat room, regardless of type: the contract's
 * `ChatRoomSummary` with its timestamps still `Date`s. `toChatRoomSummary` (chatRoom.serializer.ts)
 * turns it into what goes over the wire. `unreadCount` is explained at countUnreadMessages.
 */
export type ChatRoomSummaryData = Omit<ChatRoomSummary, 'createdAt' | 'lastMessage'> & {
  createdAt: Date;
  // The newest message that has not been deleted; null when the room has none.
  lastMessage: { id: number; senderId: number | null; content: string; createdAt: Date } | null;
};

/**
 * Unread messages per room for one user, in one query; rooms with nothing unread are absent from the
 * map, so read it with `?? 0`. A message is unread when it is above the user's `lastReadMessageId`
 * for that room (every message while the marker is null), was not sent by the user and is not deleted.
 *
 * Raw SQL because the threshold is a column of each room's own chat_members row, which a Prisma
 * relation filter cannot refer to (the alternative is one count query per room). `sender_id` is NULL
 * for messages whose author deleted their account: those are still somebody else's, so the test is
 * `IS NULL OR <>` (a plain `<>` would drop them). The (chat_id, id) index serves the lookup, and
 * `COUNT(*)::int` keeps the result a number rather than a BigInt.
 */
export async function countUnreadMessages(
  userId: number,
  chatIds: number[]
): Promise<Map<number, number>> {
  if (chatIds.length === 0) {
    return new Map();
  }

  const rows = await prisma.$queryRaw<{ chatId: number; unreadCount: number }[]>`
    SELECT m.chat_id AS "chatId", COUNT(*)::int AS "unreadCount"
    FROM messages m
    JOIN chat_members cm ON cm.chat_id = m.chat_id AND cm.member_id = ${userId}
    WHERE m.chat_id IN (${Prisma.join(chatIds)})
      AND m.deleted_at IS NULL
      AND (m.sender_id IS NULL OR m.sender_id <> ${userId})
      AND (cm.last_read_message_id IS NULL OR m.id > cm.last_read_message_id)
    GROUP BY m.chat_id
  `;

  return new Map(rows.map((row) => [row.chatId, row.unreadCount]));
}
 
/**
 * Direct rooms of a user, or just one with `chatId`. name and avatarUrl come from the *other* member:
 * a direct room has none of its own.
 */
export async function getDirectChatRoomsForUser(
  userId: number,
  chatId?: number
): Promise<ChatRoomSummaryData[]> {
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
        // A deleted message has no content left to preview, so the preview
        // falls back to the message before it (or to none).
        where: { deletedAt: null },
        orderBy: { id: 'desc' },
        take: 1,
        select: { id: true, senderId: true, content: true, createdAt: true },
      },
    },
  });
  const unreadCounts = await countUnreadMessages(userId, rooms.map((room) => room.id));
 
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
      unreadCount: unreadCounts.get(room.id) ?? 0,
    };
  });
}
 
/** Group rooms of a user, or just one with `chatId`, with the room's own name and avatarUrl. */
export async function getGroupChatRoomsForUser(
  userId: number,
  chatId?: number
): Promise<ChatRoomSummaryData[]> {
  const rooms = await prisma.chatRoom.findMany({
    where: {
      type: 'group',
      ...(chatId !== undefined ? { id: chatId } : {}),
      members: { some: { memberId: userId } },
    },
    include: {
      messages: {
        where: { deletedAt: null },
        orderBy: { id: 'desc' },
        take: 1,
        select: { id: true, senderId: true, content: true, createdAt: true },
      },
    },
  });
  const unreadCounts = await countUnreadMessages(userId, rooms.map((room) => room.id));
 
  return rooms.map((room) => ({
    id: room.id,
    type: 'group',
    name: room.name,
    avatarUrl: room.avatarUrl,
    createdAt: room.createdAt,
    lastMessage: room.messages[0] ?? null,
    unreadCount: unreadCounts.get(room.id) ?? 0,
  }));
}
 
// Most recent activity first: the time of the last message that has not been
// deleted if there is one, otherwise the room's creation time.
export function activityTimestamp(room: ChatRoomSummaryData): number {
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

export async function deleteChatRoomById(chatId: number) {
  return prisma.chatRoom.delete({
    where: { id: chatId },
  });
}

/**
 * One room as its requester sees it, or undefined when the room is gone or they are not in it. It
 * is the summary of GET /api/chat for a single room, whatever the room's type.
 */
export async function getChatRoomSummaryForUser(
  userId: number,
  chatId: number,
  roomType: RoomType
): Promise<ChatRoomSummaryData | undefined> {
  const [room] =
    roomType === 'direct'
      ? await getDirectChatRoomsForUser(userId, chatId)
      : await getGroupChatRoomsForUser(userId, chatId);
  return room;
}
