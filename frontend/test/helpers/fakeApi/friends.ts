import type {
  AcceptedFriendResponse,
  FriendListResponse,
  FriendRequestListResponse,
  FriendRequestResponse,
  SearchUserResponse,
} from '@contract/responses';
import type { FriendRequest, PublicUser, Relationship } from '@contract/types';
import { numberField } from './body';
import { json, noContent } from './responses';
import { personById, personByTel, type Body, type FakeServer } from './state';

// /api/friend, /api/friend/search/:tel, /api/friend/requests, /api/friend/requests/:id and
// /api/friend/requests/:id/accept, with the query string kept apart.
const ROUTE = /^(GET|POST|DELETE) \/api\/friend((?:\/[^/?]+)*)(?:\?(.*))?$/;

const publicUser = ({ id, name, avatarUrl }: PublicUser): PublicUser => ({ id, name, avatarUrl });

/** The friends of John, sorted by name without regard to case, like the server's list. */
function friendsOf(state: FakeServer): PublicUser[] {
  return state.friendIds
    .map((id) => personById(id))
    .filter((person) => person !== undefined)
    .map(publicUser)
    .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
}

/** A request as John sees it: `user` is the other party. Newest first comes from the caller. */
function requestView(
  request: { id: number; createdAt: string; fromId: number; toId: number },
  mine: number,
): FriendRequest {
  const other = personById(request.fromId === mine ? request.toId : request.fromId)!;
  return { id: request.id, createdAt: request.createdAt, user: publicUser(other) };
}

/** The friend endpoints; the rules follow api.doc.md. Returns `undefined` for a request that is not one of them. */
export function friendEndpoints(request: string, body: Body, state: FakeServer): Response | undefined {
  const match = ROUTE.exec(request);
  if (!match) return undefined;
  const [, method, path = '', query] = match;
  if (!state.session) return json({ error: 'Unauthorized Access' }, 401);
  const me = state.session.id;
  const segments = path.split('/').filter(Boolean); // [] | ['search', tel] | ['requests'] | ['requests', id] | ['requests', id, 'accept'] | [userId]
  const [first, second, third] = segments;

  if (first === undefined && method === 'GET') return json({ friends: friendsOf(state) } satisfies FriendListResponse);

  if (first === 'search' && second !== undefined && method === 'GET') {
    if (state.searchLimited) return json({ error: 'Too many searches, try again later' }, 429);
    const tel = decodeURIComponent(second);
    if (!/^\+[1-9]\d{6,14}$/.test(tel)) {
      return json({ error: "'tel' must be a valid phone number in E.164 format, for example +84912345678" }, 400);
    }
    const person = personByTel(tel);
    if (!person) return json({ user: null } satisfies SearchUserResponse);
    const received = state.friendRequests.find(({ fromId, toId }) => fromId === person.id && toId === me);
    const sent = state.friendRequests.find(({ fromId, toId }) => fromId === me && toId === person.id);
    // The first that applies wins: self, friend, request_received, request_sent.
    const relationship: Relationship =
      person.id === me
        ? 'self'
        : state.friendIds.includes(person.id)
          ? 'friend'
          : received
            ? 'request_received'
            : sent
              ? 'request_sent'
              : 'none';
    const requestId =
      relationship === 'request_received' ? received?.id : relationship === 'request_sent' ? sent?.id : undefined;
    return json({
      user: { ...publicUser(person), relationship, ...(requestId !== undefined && { requestId }) },
    } satisfies SearchUserResponse);
  }

  if (first === 'requests' && second === undefined) {
    if (method === 'GET') {
      const direction = new URLSearchParams(query).get('direction') ?? 'incoming';
      if (direction !== 'incoming' && direction !== 'outgoing') {
        return json({ error: "'direction' must be 'incoming' or 'outgoing'" }, 400);
      }
      const requests = state.friendRequests
        .filter(({ fromId, toId }) => (direction === 'incoming' ? toId === me : fromId === me))
        .map((pending) => requestView(pending, me))
        .reverse(); // newest first: a later request has a later id
      return json({ requests } satisfies FriendRequestListResponse);
    }
    if (method === 'POST') {
      if (state.friendRequestLimited) return json({ error: 'Too many friend requests, try again later' }, 429);
      const receiver = personById(numberField(body, 'receiver_id'));
      if (!receiver) return json({ error: 'receiver_id does not refer to an existing user' }, 400);
      if (receiver.id === me) return json({ error: 'You cannot send a friend request to yourself' }, 400);
      if (state.friendIds.includes(receiver.id)) return json({ error: 'You are already friends with this user' }, 409);
      if (state.friendRequests.some(({ fromId, toId }) => fromId === me && toId === receiver.id)) {
        return json({ error: 'You have already sent this user a friend request' }, 409);
      }
      const theirs = state.friendRequests.find(({ fromId, toId }) => fromId === receiver.id && toId === me);
      if (theirs) return json({ error: 'This user has already sent you a friend request', requestId: theirs.id }, 409);
      const created = state.addFriendRequest({ from: personById(me)!, to: receiver });
      return json({ request: requestView(created, me) } satisfies FriendRequestResponse, 201);
    }
    return undefined;
  }

  if (first === 'requests' && second !== undefined) {
    const found = state.friendRequests.find(({ id }) => id === Number(second));
    if (third === 'accept' && method === 'POST') {
      // Only the receiver can; a request that is not addressed to the requester is the same 404 as one that is not there.
      if (!found || found.toId !== me) return json({ error: 'Friend request not found' }, 404);
      state.friendRequests.splice(state.friendRequests.indexOf(found), 1);
      state.friendIds.push(found.fromId);
      return json({ friend: publicUser(personById(found.fromId)!) } satisfies AcceptedFriendResponse, 201);
    }
    if (third === undefined && method === 'DELETE') {
      if (!found || (found.fromId !== me && found.toId !== me)) return json({ error: 'Friend request not found' }, 404);
      state.friendRequests.splice(state.friendRequests.indexOf(found), 1);
      return noContent();
    }
    return undefined;
  }

  if (first !== undefined && second === undefined && method === 'DELETE') {
    const userId = Number(first);
    if (!state.friendIds.includes(userId)) return json({ error: 'You are not friends with this user' }, 404);
    state.friendIds.splice(state.friendIds.indexOf(userId), 1);
    return noContent();
  }

  return undefined;
}
