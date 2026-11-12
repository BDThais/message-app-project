import {
  queryOptions,
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { isApiError } from '@/lib/http';
import {
  acceptFriendRequest,
  deleteFriendRequest,
  getFriendRequests,
  getFriends,
  searchUserByTel,
  sendFriendRequest,
  unfriend,
} from './api';
import {
  addFriendToCache,
  addRequestToCache,
  removeFriendFromCache,
  removeRequestFromCache,
  setRelationshipInSearches,
} from './cache';
import { friendKeys } from './keys';
import type { FriendRequestDirection } from './types';

// The lists are asked for again each time the page opens or the tab comes back to the front (a stale
// time of 0): a request can be cancelled, declined or a friendship ended while nobody is looking, and
// the socket (events.ts) only says that a request arrived or was accepted. The mutations below change
// the cache from the server's answers, so they need no refetch.

export function friendsQueryOptions() {
  return queryOptions({
    queryKey: friendKeys.list(),
    queryFn: ({ signal }) => getFriends(signal),
    staleTime: 0,
  });
}

export function useFriends() {
  return useQuery(friendsQueryOptions());
}

export function friendRequestsQueryOptions(direction: FriendRequestDirection) {
  return queryOptions({
    queryKey: friendKeys.requests(direction),
    queryFn: ({ signal }) => getFriendRequests(direction, signal),
    staleTime: 0,
  });
}

export function useFriendRequests(direction: FriendRequestDirection) {
  return useQuery(friendRequestsQueryOptions(direction));
}

/**
 * The search for one number, which is already in its canonical spelling; `null` is "no search yet".
 * The limiter counts every request, so nothing here asks on its own: no retry of a failure, no
 * refetch when the tab comes back or the connection does. A search is a person pressing Search.
 */
export function useSearchUser(tel: string | null) {
  return useQuery({
    queryKey: friendKeys.search(tel ?? ''),
    queryFn: tel === null ? skipToken : ({ signal }) => searchUserByTel(tel, signal),
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

/**
 * A refusal that means what the screen shows is out of date (the request is gone or was answered, the
 * two are already friends, they are not friends): ask the server again, and the server's text says why.
 * `onOutOfDate` gets that text. A row that the refreshed list no longer has takes its own error with
 * it, so the caller that has a place for it on the page passes this. It is a hook-level callback on
 * purpose: one given to `mutate` would not run once the row is unmounted.
 */
function refreshWhenOutOfDate(queryClient: QueryClient, error: unknown, onOutOfDate?: (message: string) => void): void {
  if (isApiError(error) && (error.status === 404 || error.status === 409)) {
    void queryClient.invalidateQueries({ queryKey: friendKeys.all() });
    onOutOfDate?.(error.message);
  }
}

export function useSendFriendRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: sendFriendRequest,
    onSuccess: (request) => {
      addRequestToCache(queryClient, 'outgoing', request);
      setRelationshipInSearches(queryClient, request.user.id, 'request_sent', request.id);
    },
    onError: (error) => refreshWhenOutOfDate(queryClient, error),
  });
}

/** The variable is the request's id. */
export function useAcceptFriendRequest(onOutOfDate?: (message: string) => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: acceptFriendRequest,
    onSuccess: (friend, requestId) => {
      removeRequestFromCache(queryClient, requestId);
      addFriendToCache(queryClient, friend);
      setRelationshipInSearches(queryClient, friend.id, 'friend');
    },
    onError: (error) => refreshWhenOutOfDate(queryClient, error, onOutOfDate),
  });
}

/** Rejects a request that came in, or cancels one that was sent: the endpoint is the same. `userId` is the other person's, for the searches. */
export function useDeleteFriendRequest(onOutOfDate?: (message: string) => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ requestId }: { requestId: number; userId: number }) => deleteFriendRequest(requestId),
    onSuccess: (_result, { requestId, userId }) => {
      removeRequestFromCache(queryClient, requestId);
      setRelationshipInSearches(queryClient, userId, 'none');
    },
    onError: (error) => refreshWhenOutOfDate(queryClient, error, onOutOfDate),
  });
}

/** The variable is the other person's user id. Their direct room stays in the room list. */
export function useUnfriend(onOutOfDate?: (message: string) => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: unfriend,
    onSuccess: (_result, userId) => {
      removeFriendFromCache(queryClient, userId);
      setRelationshipInSearches(queryClient, userId, 'none');
    },
    onError: (error) => refreshWhenOutOfDate(queryClient, error, onOutOfDate),
  });
}
