import type { QueryClient } from '@tanstack/react-query';
import { friendKeys } from './keys';
import type { FriendRequest, FriendRequestDirection, PublicUser, Relationship, SearchResult } from './types';

// Every change to what the server told us about friends goes through one of these functions: the
// mutations call them with what the API answered, and the socket handlers of step 6 will call the same
// ones, so each is idempotent by id. A list that is not loaded is left alone (it will ask the server).

const DIRECTIONS = ['incoming', 'outgoing'] as const satisfies readonly FriendRequestDirection[];

/** The order GET /api/friend uses: by name without regard to case. */
export function sortFriends(friends: PublicUser[]): PublicUser[] {
  return [...friends].sort((a, b) => {
    const [nameA, nameB] = [a.name.toLowerCase(), b.name.toLowerCase()];
    if (nameA === nameB) return a.id - b.id;
    return nameA < nameB ? -1 : 1;
  });
}

export function addFriendToCache(queryClient: QueryClient, friend: PublicUser): void {
  queryClient.setQueryData<PublicUser[]>(friendKeys.list(), (friends) =>
    !friends || friends.some(({ id }) => id === friend.id) ? friends : sortFriends([...friends, friend]),
  );
}

export function removeFriendFromCache(queryClient: QueryClient, userId: number): void {
  queryClient.setQueryData<PublicUser[]>(friendKeys.list(), (friends) =>
    friends?.some(({ id }) => id === userId) ? friends.filter(({ id }) => id !== userId) : friends,
  );
}

/** A request the person just sent is the newest one, so it goes first, like the server's list has it. */
export function addRequestToCache(queryClient: QueryClient, direction: FriendRequestDirection, request: FriendRequest): void {
  queryClient.setQueryData<FriendRequest[]>(friendKeys.requests(direction), (requests) =>
    !requests || requests.some(({ id }) => id === request.id) ? requests : [request, ...requests],
  );
}

/** Whichever list it is in: a request id belongs to one of them, and the caller (accept, reject, cancel) does not need to say which. */
export function removeRequestFromCache(queryClient: QueryClient, requestId: number): void {
  for (const direction of DIRECTIONS) {
    queryClient.setQueryData<FriendRequest[]>(friendKeys.requests(direction), (requests) =>
      requests?.some(({ id }) => id === requestId) ? requests.filter(({ id }) => id !== requestId) : requests,
    );
  }
}

/**
 * Where a person stands with the signed-in user, in every cached search that shows them. Searching
 * again after each action would spend the search limit (30 per 15 minutes) on answers the client
 * already has. `requestId` goes with the two request states and is dropped for the others.
 */
export function setRelationshipInSearches(
  queryClient: QueryClient,
  userId: number,
  relationship: Relationship,
  requestId?: number,
): void {
  queryClient.setQueriesData<SearchResult | null>({ queryKey: friendKeys.searches() }, (result) =>
    result && result.id === userId && (result.relationship !== relationship || result.requestId !== requestId)
      ? { ...result, relationship, requestId }
      : result,
  );
}
