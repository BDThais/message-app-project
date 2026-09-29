import { prisma } from '../../lib/prisma';

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
