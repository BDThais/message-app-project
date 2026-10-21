import { ChatMemberRole, ChatRoomType, Prisma } from '../../generated/prisma/client';
import { prisma } from '../../lib/prisma';
import { findNonFriendIds } from '../friends/friend.service';

/**
 * How a member entry leaves the API: the membership plus the user as `member`, without a separate
 * `memberId` (the same value as `member.id`). Spread into every query whose result is sent to the
 * client, so the endpoints that return members cannot drift apart. It only shapes the output:
 * `memberId` is still usable in `where` and `orderBy`.
 */
export const memberResponseArgs = {
  omit: { memberId: true },
  include: { member: { select: { id: true, name: true, avatarUrl: true } } },
} as const;

/**
 * What writing chat_members rows needs. Both `prisma` and a `$transaction` callback's `tx` satisfy it,
 * so the same function runs on its own or inside a transaction.
 */
interface ChatMemberWriteClient {
  chatMember: {
    createMany: (args: {
      data: { chatId: number; memberId: number; role: ChatMemberRole; lastReadMessageId: number | null }[];
      skipDuplicates?: boolean;
    }) => Promise<{ count: number }>;
  };
}

/**
 * Adds users to a room with the given role. `lastReadMessageId` is the read marker they start with:
 * null for a new room, or the message that counts as read for them when the room already has some
 * (see addMembersToExistingChatRoom). Room creation calls it inside the transaction that inserts the
 * room, so the room and its first members appear together or not at all.
 */
export async function addChatRoomMembers(
  client: ChatMemberWriteClient,
  chatId: number,
  memberIds: number[],
  role: ChatMemberRole = ChatMemberRole.member,
  lastReadMessageId: number | null = null
) {
  if (memberIds.length === 0) {
    return { count: 0 };
  }

  return client.chatMember.createMany({
    data: memberIds.map((memberId) => ({ chatId, memberId, role, lastReadMessageId })),
    skipDuplicates: true,
  });
}

/**
 * Adds users to a room that already exists: all or nobody (`not_friends` adds no one).
 *
 * The friend check covers only the users who would be added, so repeating a request never fails
 * because of someone who is already in the room.
 *
 * The newest message is looked up just before the insert, not in the same statement: a message sent
 * in between is above the marker, so it stays unread for the new member, which is right because it
 * was sent after they joined.
 *
 * The insert is a single statement: a user deleted after the friend check makes it fail with the
 * foreign-key error (see isForeignKeyConstraintError) and nobody from this request is added.
 */
export async function addMembersToExistingChatRoom(
  chatId: number,
  requesterId: number,
  memberIds: number[]
) {
  const existingMembers = await prisma.chatMember.findMany({
    where: { chatId, memberId: { in: memberIds } },
    select: { memberId: true },
    orderBy: { memberId: 'asc' },
  });
  const alreadyMemberIds = existingMembers.map((row) => row.memberId);
  const newMemberIds = memberIds.filter((id) => !alreadyMemberIds.includes(id));

  if ((await findNonFriendIds(prisma, requesterId, newMemberIds)).length > 0) {
    return { status: 'not_friends' } as const;
  }

  const newestMessage =
    newMemberIds.length > 0
      ? await prisma.message.findFirst({
          where: { chatId, deletedAt: null },
          orderBy: { id: 'desc' },
          select: { id: true },
        })
      : null;

  await addChatRoomMembers(prisma, chatId, newMemberIds, ChatMemberRole.member, newestMessage?.id ?? null);

  const addedMembers = await prisma.chatMember.findMany({
    where: { chatId, memberId: { in: newMemberIds } },
    ...memberResponseArgs,
    orderBy: { memberId: 'asc' },
  });

  return { status: 'added', addedMembers, alreadyMemberIds } as const;
}

export type RemoveChatMemberResult =
  | 'removed'
  // The target isn't in this room (or the room itself no longer exists).
  | 'not_a_member'
  // Refused: the target is the room's only admin and other members remain.
  | 'only_admin';

/**
 * Removes one member: "leave" (the target is the requester) or an admin removing someone else, which
 * the controller decides. A group room that still has members keeps at least one admin.
 *
 * The room row is locked (SELECT ... FOR UPDATE) because that rule is "check the admin count, then
 * delete": without the lock, two admins leaving at the same moment can both pass the check, each
 * seeing the other as an admin, and both be deleted, leaving members and no admin. Locked,
 * concurrent removals in a room run one at a time, and the second re-reads the counts.
 */
export async function removeMemberFromChatRoom(
  chatId: number,
  targetId: number,
  roomType: ChatRoomType
): Promise<RemoveChatMemberResult> {
  return prisma.$transaction(async (tx) => {
    const lockedRooms = await tx.$queryRaw<{ id: number }[]>`
      SELECT id FROM chat_rooms WHERE id = ${chatId} FOR UPDATE
    `;
    if (lockedRooms.length === 0) {
      return 'not_a_member';
    }

    const target = await tx.chatMember.findUnique({
      where: { memberId_chatId: { memberId: targetId, chatId } },
      select: { role: true },
    });
    if (!target) {
      return 'not_a_member';
    }

    if (roomType === ChatRoomType.group && target.role === ChatMemberRole.admin) {
      const adminCount = await tx.chatMember.count({
        where: { chatId, role: ChatMemberRole.admin },
      });
      const memberCount = await tx.chatMember.count({ where: { chatId } });

      if (adminCount === 1 && memberCount > 1) {
        return 'only_admin';
      }
    }

    const { count } = await tx.chatMember.deleteMany({
      where: { chatId, memberId: targetId },
    });
    if (count === 0) {
      return 'not_a_member';
    }

    // The last member just left: start the clock for the delayed cleanup.
    // Done in this transaction so the room is never empty without a stamp.
    if ((await tx.chatMember.count({ where: { chatId } })) === 0) {
      await tx.chatRoom.update({ where: { id: chatId }, data: { emptiedAt: new Date() } });
    }
    return 'removed';
  });
}

type ChatMemberWithUser = Prisma.ChatMemberGetPayload<typeof memberResponseArgs>;

export type ChangeMemberRoleResult =
  | { outcome: 'updated'; member: ChatMemberWithUser }
  // The target isn't in this room.
  | { outcome: 'not_a_member' }
  // Refused: demoting the target would leave the room with no admin at all.
  | { outcome: 'only_admin' };

/**
 * Changes a member's role. Group rooms only: a direct room's two members are both admins by design,
 * and the route's requireGroupRoom keeps this from running for one. A group room that still has
 * members keeps at least one admin, the same rule as removeMemberFromChatRoom.
 *
 * The room row is locked (SELECT ... FOR UPDATE) for the same reason as there: two concurrent
 * demotions could each still see the other admin in place and both succeed.
 */
export async function changeMemberRoleInChatRoom(
  chatId: number,
  targetId: number,
  role: ChatMemberRole
): Promise<ChangeMemberRoleResult> {
  return prisma.$transaction(async (tx) => {
    const lockedRooms = await tx.$queryRaw<{ id: number }[]>`
      SELECT id FROM chat_rooms WHERE id = ${chatId} FOR UPDATE
    `;
    if (lockedRooms.length === 0) {
      return { outcome: 'not_a_member' };
    }

    const target = await tx.chatMember.findUnique({
      where: { memberId_chatId: { memberId: targetId, chatId } },
      select: { role: true },
    });
    if (!target) {
      return { outcome: 'not_a_member' };
    }

    if (target.role === ChatMemberRole.admin && role === ChatMemberRole.member) {
      const adminCount = await tx.chatMember.count({
        where: { chatId, role: ChatMemberRole.admin },
      });
      const memberCount = await tx.chatMember.count({ where: { chatId } });

      if (adminCount === 1 && memberCount > 1) {
        return { outcome: 'only_admin' };
      }
    }

    const member = await tx.chatMember.update({
      where: { memberId_chatId: { memberId: targetId, chatId } },
      data: { role },
      ...memberResponseArgs,
    });

    return { outcome: 'updated', member };
  });
}

/**
 * Lists everyone in a room, admins first, then by name. The sort is done here, not in the query, so
 * the order does not depend on the database's collation (with a "C" collation a plain `ORDER BY name`
 * puts "Zed" before "alice"). Names that differ only by case compare equal, and the query's order by
 * user id decides between them (Array.prototype.sort is stable).
 */
export async function getMembersForChatRoom(chatId: number): Promise<ChatMemberWithUser[]> {
  const members = await prisma.chatMember.findMany({
    where: { chatId },
    ...memberResponseArgs,
    orderBy: { memberId: 'asc' },
  });

  const roleRank = (role: ChatMemberRole) => (role === ChatMemberRole.admin ? 0 : 1);

  return members.sort(
    (a, b) =>
      roleRank(a.role) - roleRank(b.role) ||
      a.member.name.localeCompare(b.member.name, 'en', { sensitivity: 'base' })
  );
}

export type MarkChatRoomReadResult =
  // `lastReadMessageId` is the marker as it stands after the call: the message
  // that was asked for, or the later one that was already there.
  | { outcome: 'marked'; lastReadMessageId: number }
  // No message with this id in this room (a soft-deleted one still counts).
  | { outcome: 'message_not_found' }
  // The requester left the room between the membership check and this call.
  | { outcome: 'not_a_member' };

/**
 * Moves the requester's read marker forward to a message. A message at or below the marker changes
 * nothing and is not an error.
 *
 * That rule is the `where` of one conditional `updateMany` (marker is null or lower than the new
 * value), not a read followed by a write, so two requests racing each other (several tabs, out of
 * order) cannot move the marker back. The marker is read only when the update changed nothing, to
 * report where it stands.
 *
 * The message must belong to this room. A soft-deleted one still counts: it keeps its place in the
 * history.
 */
export async function markChatRoomRead(
  chatId: number,
  memberId: number,
  messageId: number
): Promise<MarkChatRoomReadResult> {
  const message = await prisma.message.findFirst({
    where: { id: messageId, chatId },
    select: { id: true },
  });
  if (!message) {
    return { outcome: 'message_not_found' };
  }

  const { count } = await prisma.chatMember.updateMany({
    where: {
      chatId,
      memberId,
      OR: [{ lastReadMessageId: null }, { lastReadMessageId: { lt: messageId } }],
    },
    data: { lastReadMessageId: messageId },
  });
  if (count > 0) {
    return { outcome: 'marked', lastReadMessageId: messageId };
  }

  // Nothing moved: the marker is already at or past this message.
  const current = await prisma.chatMember.findUnique({
    where: { memberId_chatId: { memberId, chatId } },
    select: { lastReadMessageId: true },
  });
  if (!current) {
    return { outcome: 'not_a_member' };
  }
  // The update above also matches a null marker, so a row it skipped has one at or past `messageId`.
  // A null here would mean the message the marker pointed at vanished in between; messages are never
  // hard-deleted apart from the whole room, and that takes this row with it.
  if (current.lastReadMessageId === null) {
    throw new Error(`last_read_message_id of member ${memberId} in room ${chatId} is null after an update that skipped it`);
  }

  return { outcome: 'marked', lastReadMessageId: current.lastReadMessageId };
}
