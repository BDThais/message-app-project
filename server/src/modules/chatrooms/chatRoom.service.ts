import { addChatRoomMembers, memberResponseArgs } from './chatMember.service';
import { findNonFriendIds } from '../friends/friend.service';
import { prisma } from '../../lib/prisma';
import { Prisma, ChatRoomType, ChatMemberRole } from '../../generated/prisma/client';

const memberInclude = { members: memberResponseArgs } as const;

type ChatRoomWithMembers = Prisma.ChatRoomGetPayload<{ include: typeof memberInclude }>;

export type CreateChatRoomResult =
  | { status: 'ok'; room: ChatRoomWithMembers; created: boolean }
  // Refused: at least one of `memberIds` is not a friend of the requester (or
  // does not exist, which is not told apart). Nothing was created.
  | { status: 'not_friends' };

/**
 * Behind POST /chat. Everyone the requester invites has to be their friend,
 * checked before anything is written, so a refused request creates no room
 * and no members. For a direct room the check also comes before the lookup of
 * an existing room, so a room between two former friends is not handed out
 * again here (it is still listed by GET /chat and keeps working). A group room
 * with no `memberIds` needs no friends.
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
 * POST /chat/:chatid/member will use.
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
  // The newest message that has not been deleted; null when the room has none.
  lastMessage: { content: string; createdAt: Date } | null;
  // Messages from other people that the requester has not read yet, see countUnreadMessages.
  unreadCount: number;
}

/**
 * How many unread messages the user has in each of the given rooms, in one
 * query. A message is unread when it is in the room, has an id above the
 * user's own `lastReadMessageId` for that room (every message when the marker
 * is still null), was not sent by the user and has not been deleted. Rooms
 * with nothing unread are absent from the map, so read it with `?? 0`.
 *
 * Written as SQL because the threshold is a column of each room's own
 * chat_members row, which a Prisma relation filter cannot refer to; the
 * alternative is one count query per room. `sender_id` is NULL for messages
 * whose author deleted their account: those are still somebody else's
 * messages, so the test is `IS NULL OR <>` (a plain `<>` would drop them).
 * The (chat_id, id) index serves the lookup, and `COUNT(*)::int` keeps the
 * result a number rather than a BigInt.
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
 * Fetch direct chat rooms for a user.
 * Reusable by GET /chat (no chatId) and later by GET /chat/:chatid
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
        // A deleted message has no content left to preview, so the preview
        // falls back to the message before it (or to none).
        where: { deletedAt: null },
        orderBy: { id: 'desc' },
        take: 1,
        select: { content: true, createdAt: true },
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
        where: { deletedAt: null },
        orderBy: { id: 'desc' },
        take: 1,
        select: { content: true, createdAt: true },
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

export async function deleteChatRoomById(chatId: number) {
  return prisma.chatRoom.delete({
    where: { id: chatId },
  });
}