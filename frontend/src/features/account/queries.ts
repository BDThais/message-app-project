import {
  queryOptions,
  useMutation,
  useMutationState,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { isApiError } from '@/lib/http';
import {
  changePassword,
  deleteAccount,
  getMe,
  login,
  logout,
  requestPasswordReset,
  resendVerificationEmail,
  resetPassword,
  signup,
  updateProfile,
  verifyEmail,
} from './api';
import type { DeleteAccountConflictBody } from '@contract/errors';
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

/** Signing out and deleting the account are the two ways a person ends their own session on purpose. */
const endSessionKey = ['account', 'end-session'] as const;

/**
 * True from the click until the request fails, and stays true once it has succeeded: by then the
 * cached user is `null` and the layout is about to leave for /login, which `useRedirectWhenSignedOut`
 * must not take for a session that ended by itself. It reads the mutation cache and not one
 * component's mutation, because the delete button is deeper in the page than the layout that redirects.
 */
export function useEndingSession(): boolean {
  return useMutationState({
    filters: { mutationKey: endSessionKey },
    select: (mutation) => mutation.state.status,
  }).some((status) => status === 'pending' || status === 'success');
}

/** `gcTime: 0`: a finished sign-out must not stay in the cache and make the next session look as if it were ending. */
export function useSignOut() {
  const queryClient = useQueryClient();
  const signOut = useMutation({
    mutationKey: endSessionKey,
    gcTime: 0,
    mutationFn: logout,
    onSuccess: () => setSignedInUser(queryClient, null),
  });
  const isSigningOut = useEndingSession();
  return { signOut: () => signOut.mutate(), isSigningOut };
}

/** Puts the user the server answers with into the cache; that is the one place the header and the forms read the name from. */
export function useUpdateProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateProfile,
    onSuccess: (user) => queryClient.setQueryData(accountKeys.me(), user),
  });
}

/** A wrong current password is a 401 that leaves the session valid (see `createApp.ts`); the person stays signed in. */
export function useChangePassword() {
  return useMutation({ mutationFn: changePassword });
}

/**
 * Deletes the account and leaves like a sign-out does. A `409` means the person is the only admin of
 * group rooms that still have other members: `blockingRoomIds` reads their ids from the error.
 */
export function useDeleteAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: endSessionKey,
    gcTime: 0,
    mutationFn: deleteAccount,
    onSuccess: () => setSignedInUser(queryClient, null),
  });
}

/** The rooms that stop an account from being deleted (the `409`'s `chatIds`), or `[]` when the error carries none. */
export function blockingRoomIds(error: unknown): number[] {
  if (!isApiError(error)) return [];
  const { chatIds } = (error.body ?? {}) as Partial<DeleteAccountConflictBody>;
  return Array.isArray(chatIds) ? chatIds.filter((id) => typeof id === 'number') : [];
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
