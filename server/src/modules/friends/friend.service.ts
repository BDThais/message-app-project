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
