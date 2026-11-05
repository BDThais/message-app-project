import { queryOptions, skipToken, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { isApiError } from '@/lib/http';
import { acceptFriendRequest, deleteFriendRequest, getFriendRequests, getFriends, searchUserByTel, sendFriendRequest, unfriend } from './api';
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
// time of 0): a request can arrive or be answered while nobody is looking, and until step 6 nothing
// pushes it. The mutations below change the cache from the server's answers, so they need no refetch.

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
 */
function refreshWhenOutOfDate(queryClient: QueryClient, error: unknown): void {
  if (isApiError(error) && (error.status === 404 || error.status === 409)) {
    void queryClient.invalidateQueries({ queryKey: friendKeys.all() });
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
export function useAcceptFriendRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: acceptFriendRequest,
    onSuccess: (friend, requestId) => {
      removeRequestFromCache(queryClient, requestId);
      addFriendToCache(queryClient, friend);
      setRelationshipInSearches(queryClient, friend.id, 'friend');
    },
    onError: (error) => refreshWhenOutOfDate(queryClient, error),
  });
}

/** Rejects a request that came in, or cancels one that was sent: the endpoint is the same. `userId` is the other person's, for the searches. */
export function useDeleteFriendRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ requestId }: { requestId: number; userId: number }) => deleteFriendRequest(requestId),
    onSuccess: (_result, { requestId, userId }) => {
      removeRequestFromCache(queryClient, requestId);
      setRelationshipInSearches(queryClient, userId, 'none');
    },
    onError: (error) => refreshWhenOutOfDate(queryClient, error),
  });
}

/** The variable is the other person's user id. Their direct room stays in the room list. */
export function useUnfriend() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: unfriend,
    onSuccess: (_result, userId) => {
      removeFriendFromCache(queryClient, userId);
      setRelationshipInSearches(queryClient, userId, 'none');
    },
    onError: (error) => refreshWhenOutOfDate(queryClient, error),
  });
}
