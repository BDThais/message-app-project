import { queryOptions, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { isApiError } from '../../lib/http';
import { getMe, login, logout, requestPasswordReset, resendVerificationEmail, resetPassword, signup, verifyEmail } from './api';
import type { User } from './types';

export const accountKeys = {
  me: () => ['me'] as const,
};

/** The signed-in user, or `null` when signed out. Also what the route guards read. */
export function meQueryOptions() {
  return queryOptions({
    queryKey: accountKeys.me(),
    queryFn: ({ signal }) => getMe(signal),
    // The session is checked again whenever a request answers 401 (see createApp.ts), so it is safe to
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

/**
 * Forgets the cached `me`, so the next guard asks the server who is signed in. For things that
 * happen outside the cache's sight: an address verified from a mailed link, or a reset password
 * that signed every session of the account out. (A reset, unlike an invalidation, also drops the
 * old answer, which the route guards (see `cachedMe`) would otherwise keep handing out.)
 */
export function recheckSession(queryClient: QueryClient): void {
  queryClient.resetQueries({ queryKey: accountKeys.me(), exact: true });
}

/** Creates an account. The cache is untouched: signup does not sign anyone in. */
export function useSignup() {
  return useMutation({ mutationFn: signup });
}

/** The "verify your email" banner's resend button. */
export function useResendVerificationEmail() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: resendVerificationEmail,
    onError: (error) => {
      // 409 "Email is already verified": it was verified elsewhere (another tab, a phone) after `me`
      // was cached. Fetch the truth, and the banner goes away.
      if (isApiError(error) && error.status === 409) void queryClient.invalidateQueries({ queryKey: accountKeys.me() });
    },
  });
}

/** For the page behind the mailed verification link, which is outside the `_app` layout. */
export function useVerifyEmail() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: verifyEmail,
    // The link may belong to a different account than the one signed in here, so do not patch
    // `emailVerified` into the cached user: ask again.
    onSuccess: () => recheckSession(queryClient),
  });
}

export function useRequestPasswordReset() {
  return useMutation({ mutationFn: requestPasswordReset });
}

/** For the page behind the mailed reset link, which is outside the `_app` layout. */
export function useResetPassword() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: resetPassword,
    // Every session of the account was deleted, possibly including the one in this tab.
    onSuccess: () => recheckSession(queryClient),
  });
}
