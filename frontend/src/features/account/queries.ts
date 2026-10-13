import { queryOptions, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { getMe, login, logout } from './api';
import type { User } from './types';

export const accountKeys = {
  me: () => ['me'] as const,
};

/** The signed-in user, or `null` when signed out. Also what the route guards read. */
export function meQueryOptions() {
  return queryOptions({
    queryKey: accountKeys.me(),
    queryFn: ({ signal }) => getMe(signal),
    // The session is checked again whenever a request answers 401 (see main.tsx), so it is safe to
    // trust the cached answer for a while.
    staleTime: 5 * 60_000,
  });
}

export function useMe() {
  return useQuery(meQueryOptions());
}

/**
 * Records who is signed in (or `null`) and throws away everything else in the cache, so the next
 * person to use this tab never sees the previous user's rooms or messages.
 */
export function setSignedInUser(queryClient: QueryClient, user: User | null): void {
  queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== accountKeys.me()[0] });
  queryClient.setQueryData(accountKeys.me(), user);
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: login,
    onSuccess: (user) => setSignedInUser(queryClient, user),
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: logout,
    onSuccess: () => setSignedInUser(queryClient, null),
  });
}
