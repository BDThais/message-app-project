import { prisma } from '../../lib/prisma';
import { Prisma } from '../../generated/prisma/client';

/**
 * How the requester relates to the user a search found; the client picks the
 * button to show from it.
 */
export type FriendRelationship = 'self' | 'friend' | 'request_sent' | 'request_received' | 'none';

/**
 * A user as other users see them (never email or tel), plus their relationship
 * to the requester. `requestId` is only present for the two request states, so
 * the client can cancel or accept without another call.
 */
export type UserSearchResult = {
  id: number;
  name: string;
  avatarUrl: string | null;
  relationship: FriendRelationship;
  requestId?: number;
};

/**
 * Exact phone-number lookup behind GET /friend/search/:tel. `tel` is expected
 * to be validated already (see validateTelParam). Returns null when nobody has
 * that number.
 *
 * The relationship comes from the same query as the user. Each of the three
 * relations below is narrowed to rows that involve the requester, so it holds
 * at most one row:
 * - friendOfLists: friend-list rows that name the found user as the friend,
 *   narrowed to the requester's own row. That is the row GET /friend reads,
 *   so the two endpoints agree on who is a friend.
 * - sentFriendRequests: requests the found user sent to the requester.
 * - receivedFriendRequests: requests the requester sent to the found user.
 *
 * When more than one applies, the first match wins, in this order: self,
 * friend, request_received, request_sent. Two requests can only coexist in
 * both directions through the known send-at-the-same-instant race (see
 * "Friend endpoints" in the planning doc); "received" wins because accepting it
 * clears both.
 */
export async function findUserByTel(
  requesterId: number,
  tel: string
): Promise<UserSearchResult | null> {
  const user = await prisma.user.findUnique({
    where: { tel },
    select: {
      id: true,
      name: true,
      avatarUrl: true,
      friendOfLists: { where: { userId: requesterId }, select: { userId: true } },
      sentFriendRequests: { where: { receiverId: requesterId }, select: { id: true } },
      receivedFriendRequests: { where: { senderId: requesterId }, select: { id: true } },
    },
  });

  if (!user) return null;

  const profile = { id: user.id, name: user.name, avatarUrl: user.avatarUrl };

  if (user.id === requesterId) {
    return { ...profile, relationship: 'self' };
  }

  if (user.friendOfLists.length > 0) {
    return { ...profile, relationship: 'friend' };
  }

  const incoming = user.sentFriendRequests[0];
  if (incoming) {
    return { ...profile, relationship: 'request_received', requestId: incoming.id };
  }

  const outgoing = user.receivedFriendRequests[0];
  if (outgoing) {
    return { ...profile, relationship: 'request_sent', requestId: outgoing.id };
  }

  return { ...profile, relationship: 'none' };
}

/** A user as other users see them: never email or tel. */
export type PublicUser = { id: number; name: string; avatarUrl: string | null };

/**
 * A pending friend request as the API shows it. `user` is always the *other*
 * party: the receiver in what POST /friend/requests answers with and in the
 * outgoing list, the sender in the incoming list.
 */
export type FriendRequestSummary = {
  id: number;
  createdAt: Date;
  user: PublicUser;
};

export type SendFriendRequestResult =
  | { status: 'created'; request: FriendRequestSummary }
  | { status: 'receiver_not_found' }
  | { status: 'already_friends' }
  | { status: 'already_sent' }
  // The receiver already sent the requester a request; `requestId` lets the
  // client offer "Accept" for it directly.
  | { status: 'already_received'; requestId: number };

function isPrismaError(err: unknown, code: string): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === code;
}

/**
 * Behind POST /friend/requests. `receiverId` is expected to be validated
 * already (see validateSendFriendRequestBody). Nothing is thrown for the
 * outcomes the API answers with a 4xx; they come back as a `status` instead.
 *
 * The receiver and their relationship to the sender come from one query, with
 * each relation narrowed to rows that involve the sender (the same shape as
 * findUserByTel). When more than one applies, the first match wins, in this
 * order: already friends, receiver already sent one, sender already sent one.
 *
 * The checks and the insert are not one transaction on purpose. A duplicate
 * that slips in between (double click, two tabs) hits the unique constraint
 * (P2002) and is reported as `already_sent`, the same as if the check had
 * caught it. A receiver deleted in that gap fails the foreign key (P2003) and
 * is reported as `receiver_not_found`. Two users sending each other a request
 * at the same instant can both succeed; that race is accepted (see "Friend
 * endpoints" in the planning doc) because accepting clears both directions.
 */
export async function createFriendRequest(
  senderId: number,
  receiverId: number
): Promise<SendFriendRequestResult> {
  const receiver = await prisma.user.findUnique({
    where: { id: receiverId },
    select: {
      id: true,
      name: true,
      avatarUrl: true,
      friendOfLists: { where: { userId: senderId }, select: { userId: true } },
      sentFriendRequests: { where: { receiverId: senderId }, select: { id: true } },
      receivedFriendRequests: { where: { senderId }, select: { id: true } },
    },
  });

  if (!receiver) return { status: 'receiver_not_found' };

  if (receiver.friendOfLists.length > 0) return { status: 'already_friends' };

  const incoming = receiver.sentFriendRequests[0];
  if (incoming) return { status: 'already_received', requestId: incoming.id };

  if (receiver.receivedFriendRequests.length > 0) return { status: 'already_sent' };

  try {
    const created = await prisma.pendingFriendRequest.create({
      data: { senderId, receiverId },
      select: { id: true, createdAt: true },
    });

    return {
      status: 'created',
      request: {
        id: created.id,
        createdAt: created.createdAt,
        user: { id: receiver.id, name: receiver.name, avatarUrl: receiver.avatarUrl },
      },
    };
  } catch (err) {
    if (isPrismaError(err, 'P2002')) return { status: 'already_sent' };
    if (isPrismaError(err, 'P2003')) return { status: 'receiver_not_found' };
    throw err;
  }
}

/**
 * Which side of the pending requests GET /friend/requests lists: `incoming`
 * is the inbox (requests others sent to the requester), `outgoing` is what the
 * requester sent and can still cancel.
 */
export type FriendRequestDirection = 'incoming' | 'outgoing';

const publicUserSelect = { id: true, name: true, avatarUrl: true } as const;

// Newest first. `id` breaks ties between requests with the same createdAt, so
// the order does not change from one call to the next.
const newestFirst: Prisma.PendingFriendRequestOrderByWithRelationInput[] = [
  { createdAt: 'desc' },
  { id: 'desc' },
];

/**
 * Behind GET /friend/requests: the requester's pending requests in one
 * direction, newest first, each with the other party as `user`. The other
 * party is selected down to `{ id, name, avatarUrl }` in the query itself, so
 * email and tel never leave the database. There is no pagination yet.
 *
 * Both queries are served by an index: `incoming` filters on receiverId (the
 * @@index added for the inbox), `outgoing` on senderId (the leading column of
 * @@unique([senderId, receiverId])). Requests cascade with their users, so
 * the other party always exists.
 */
export async function listFriendRequests(
  requesterId: number,
  direction: FriendRequestDirection
): Promise<FriendRequestSummary[]> {
  if (direction === 'incoming') {
    const rows = await prisma.pendingFriendRequest.findMany({
      where: { receiverId: requesterId },
      orderBy: newestFirst,
      select: { id: true, createdAt: true, sender: { select: publicUserSelect } },
    });

    return rows.map(({ id, createdAt, sender }) => ({ id, createdAt, user: sender }));
  }

  const rows = await prisma.pendingFriendRequest.findMany({
    where: { senderId: requesterId },
    orderBy: newestFirst,
    select: { id: true, createdAt: true, receiver: { select: publicUserSelect } },
  });

  return rows.map(({ id, createdAt, receiver }) => ({ id, createdAt, user: receiver }));
}

export type AcceptFriendRequestResult =
  | { status: 'accepted'; friend: PublicUser }
  // The request does not exist, or is not addressed to the requester. The two
  // cases are not told apart, so nobody can probe other users' requests.
  | { status: 'not_found' };

/**
 * Behind POST /friend/requests/:id/accept. `requestId` is expected to be
 * validated already (see validateRequestIdParam). Only the receiver can accept:
 * the request is looked up by its ID *and* `receiverId = requesterId`.
 *
 * One transaction: create both friend-list rows, then delete every pending
 * request between the two users in either direction (this also clears the
 * send-at-the-same-instant race, see "Friend endpoints" in the planning doc).
 * The rows are created with `skipDuplicates`, so a half-written friendship is
 * completed and a repeated or concurrent accept does not fail. They are also
 * always created in the same order, so concurrent accepts do not deadlock on
 * each other's rows (see below).
 *
 * A sender who is deleted in the gap between the lookup and the insert fails
 * the foreign key (P2003); their requests are gone with them, so it is reported
 * as `not_found`, like any other request that no longer exists.
 */
export async function acceptPendingFriendRequest(
  requesterId: number,
  requestId: number
): Promise<AcceptFriendRequestResult> {
  try {
    return await prisma.$transaction(async (tx) => {
      const pending = await tx.pendingFriendRequest.findFirst({
        where: { id: requestId, receiverId: requesterId },
        select: { sender: { select: publicUserSelect } },
      });

      if (!pending) return { status: 'not_found' } as const;

      const friend = pending.sender;

      // The two rows always go in in the same order (lower user ID first),
      // whoever accepts. Two users who sent each other a request can accept at
      // the same instant; if each transaction inserted its own side first, each
      // could end up waiting on the row the other just inserted, and Postgres
      // would abort one of them as a deadlock (a 500). In one fixed order the
      // second transaction just waits for the first and then skips the rows.
      const [lowId, highId] =
        requesterId < friend.id ? [requesterId, friend.id] : [friend.id, requesterId];

      await tx.friendListMember.createMany({
        data: [
          { userId: lowId, friendId: highId },
          { userId: highId, friendId: lowId },
        ],
        skipDuplicates: true,
      });

      await tx.pendingFriendRequest.deleteMany({
        where: {
          OR: [
            { senderId: friend.id, receiverId: requesterId },
            { senderId: requesterId, receiverId: friend.id },
          ],
        },
      });

      return { status: 'accepted', friend } as const;
    });
  } catch (err) {
    if (isPrismaError(err, 'P2003')) return { status: 'not_found' };
    throw err;
  }
}

export type RemoveFriendResult = { status: 'removed' } | { status: 'not_friends' };

/**
 * Behind DELETE /friend/:id. `friendId` is expected to be validated already
 * (see validateUserIdParam). The two are friends when the requester's own
 * friend-list row names `friendId`; that is the row GET /friend and
 * findUserByTel read, so the endpoints agree on who is a friend. Anything else
 * (a stranger, a user who does not exist, the requester's own ID) is
 * `not_friends`, so nobody can probe which user IDs exist.
 *
 * One transaction: check the requester's row, then delete both rows of the
 * pair in a single `deleteMany`. That also removes a leftover row on the other
 * side, so the pair is gone for both of them. Unlike accepting, this needs no
 * fixed row order: both rows go in one DELETE statement, so two friends
 * removing each other at the same instant just queue on the same rows. The
 * second of two concurrent calls finds nothing left to delete and may still
 * answer `removed`; that is harmless, the friendship is gone either way.
 *
 * Existing direct chat rooms and their messages are left alone, and so are
 * pending friend requests (a pair that are friends has none, accepting clears
 * them).
 */
export async function removeFriend(
  requesterId: number,
  friendId: number
): Promise<RemoveFriendResult> {
  return prisma.$transaction(async (tx) => {
    const own = await tx.friendListMember.findUnique({
      where: { userId_friendId: { userId: requesterId, friendId } },
      select: { userId: true },
    });

    if (!own) return { status: 'not_friends' } as const;

    await tx.friendListMember.deleteMany({
      where: {
        OR: [
          { userId: requesterId, friendId },
          { userId: friendId, friendId: requesterId },
        ],
      },
    });

    return { status: 'removed' } as const;
  });
}
