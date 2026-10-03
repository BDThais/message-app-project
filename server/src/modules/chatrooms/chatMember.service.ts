import { ChatMemberRole, ChatRoomType, Prisma } from '../../generated/prisma/client';
import { prisma } from '../../lib/prisma';
import { findNonFriendIds } from '../friends/friend.service';

/**
 * How a member entry leaves the API: the membership (`chatId`, `role`,
 * `lastReadMessageId`) plus the user as `member: { id, name, avatarUrl }`.
 * `memberId` is left out because it is the same value as `member.id`, so a
 * client reads the user from one place. Spread into every query whose result
 * is sent to the client (room creation, list members, add members, change role)
 * so the four endpoints cannot drift apart. It only shapes the output: `memberId` is still
 * usable in `where` and `orderBy`.
 */
export const memberResponseArgs = {
  omit: { memberId: true },
  include: { member: { select: { id: true, name: true, avatarUrl: true } } },
} as const;

/**
 * Minimal shape needed to write chat_members rows. Both the main `prisma`
 * client and a `$transaction` callback's `tx` client satisfy this
 * structurally, so the same function works standalone or as part of an
 * atomic transaction — no explicit Prisma transaction type import needed.
 */
interface ChatMemberWriteClient {
  chatMember: {
    createMany: (args: {
      data: { chatId: number; memberId: number; role: ChatMemberRole }[];
      skipDuplicates?: boolean;
    }) => Promise<{ count: number }>;
  };
}

/**
 * Adds one or more users to a chat room as chat members with the given role.
 *
 * Reused by:
 * - POST /chat (room creation) — called inside a transaction alongside
 *   the ChatRoom insert, so the room and its initial members are created
 *   atomically.
 * - POST /chat/:chatid/member — called (via
 *   addMembersToExistingChatRoom below) with the main `prisma` client,
 *   using the default role: 'member'.
 */
export async function addChatRoomMembers(
  client: ChatMemberWriteClient,
  chatId: number,
  memberIds: number[],
  role: ChatMemberRole = ChatMemberRole.member
) {
  if (memberIds.length === 0) {
    return { count: 0 };
  }

  return client.chatMember.createMany({
    data: memberIds.map((memberId) => ({ chatId, memberId, role })),
    skipDuplicates: true,
  });
}

/**
 * Adds users to a room that already exists (POST /chat/:chatid/member).
 *
 * Users who are already members are left completely untouched - in
 * particular an existing admin is never downgraded to 'member' - and are
 * reported back in `alreadyMemberIds` instead of failing the request.
 * Everyone else joins with the default role: 'member', but only if they are
 * a friend of the requester. The friend check covers just the users who would
 * be added: an existing member is skipped whether or not they are still a
 * friend, so repeating a request never fails because of someone already in
 * the room. If any of the others is not a friend (or does not exist, which is
 * not told apart) the result is `not_friends` and *nobody* from this request
 * is added.
 *
 * The insert is a single statement, so if a user is deleted after the friend
 * check the foreign-key error (see isForeignKeyConstraintError) is thrown and
 * likewise nobody from this request is added.
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

  await addChatRoomMembers(prisma, chatId, newMemberIds);

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
 * Removes one member from a room (DELETE /chat/:chatid/member/:userid).
 * Used both for "leave" (target is the requester) and for an admin removing
 * someone else - who is allowed to do which is decided by the controller.
 *
 * Business rule enforced here: a group room that still has members must
 * always keep at least one admin, so the only admin can't be removed while
 * anyone else remains. Direct rooms are exempt (both members are admins).
 * The room row itself is never deleted here: when the last member leaves,
 * the room is stamped with `emptiedAt` and stays (with no members) until the
 * cleanup job deletes it after the retention period
 * (see chatRoomCleanup.service.ts).
 *
 * Why the room row is locked (SELECT ... FOR UPDATE): the rule above is
 * "check the admin count, then delete". Without a lock, two admins leaving
 * at the same moment can both pass the check (each still sees the other as
 * an admin) and both get deleted, leaving members and no admin. Locking the
 * room row makes concurrent removals in the same room run one at a time, so
 * the second one re-reads the counts after the first has finished.
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
 * Changes a member's role (PATCH /chat/:chatid/member/:userid). Only
 * reachable for group rooms - a direct room's two members are both admins by
 * design (see createDirectChatRoom), and the route guards against direct
 * rooms with requireGroupRoom before this ever runs.
 *
 * Business rule enforced here: a group room that still has members must
 * always keep at least one admin, so its only admin can't be demoted to
 * 'member' while anyone else remains - the same invariant
 * removeMemberFromChatRoom enforces for leaving/removal. Promoting a member
 * to admin, or setting a role a member already has, is always allowed.
 *
 * The room row is locked (SELECT ... FOR UPDATE) for the same reason as in
 * removeMemberFromChatRoom: without it, two concurrent demotions could each
 * still see the other admin in place and both succeed, leaving members with
 * no admin at all.
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
 * Lists everyone in a room (GET /chat/:chatid/member): admins first, then by
 * name. Membership is already guaranteed by loadChatMembership by the time
 * this runs, and the list is the same for every member, so nothing here
 * depends on who is asking.
 *
 * The sort is done here, not in the query, so the order does not depend on the
 * database's collation: with a plain `ORDER BY name` a "C" collation puts
 * every capital letter before every lowercase one ("Zed" before "alice").
 * Names that differ only by case compare equal, and the query's order by user
 * id decides between them (Array.prototype.sort is stable).
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
  | { outcome: 'marked'; lastReadMessageId: number | null }
  // No message with this id in this room (a soft-deleted one still counts).
  | { outcome: 'message_not_found' }
  // The requester left the room between the membership check and this call.
  | { outcome: 'not_a_member' };

/**
 * Marks a room as read up to a message (PUT /chat/:chatid/read) by moving the
 * requester's `lastReadMessageId` forward.
 *
 * The marker only moves forward: asking for a message at or below the current
 * marker changes nothing and is not an error, so out-of-order requests from
 * several tabs cannot move it back. That rule is the `where` of one
 * conditional `updateMany` (marker is null or lower than the new value), not a
 * read followed by a write, so two requests racing each other cannot undo the
 * later one. Only when the update changed nothing is the marker read, to
 * report where it stands.
 *
 * The message must belong to this room, soft-deleted or not (a deleted message
 * keeps its place in the history, so a client that has just loaded it can
 * still be told it was read). Membership of the requester is already
 * guaranteed by loadChatMembership.
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

  return { outcome: 'marked', lastReadMessageId: current.lastReadMessageId };
}
