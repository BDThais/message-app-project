import { useEffect } from 'react';
import { useRouter } from '@tanstack/react-router';
import type { User } from './types';

/**
 * The guard (`requireUser`) only runs when navigating. If the session ends while a page is open (a
 * request answered 401 and GET /account/me then came back empty, or this person signed out), the
 * cached user becomes `null` and this sends them to the login page. When `isSigningOut` is true (the
 * person clicked "Sign out", see `useSignOut`) it is a deliberate sign-out: plain /login, no `redirect`.
 *
 * The page they were on is read from the router inside the effect, once, and not from a hook: a
 * value that changes with the location would make the effect run again for the /login URL it has
 * just navigated to, and the `redirect` parameter would nest into itself without end.
 */
export function useRedirectWhenSignedOut(
  user: User | null | undefined,
  { isSigningOut }: { isSigningOut: boolean },
): void {
  const router = useRouter();

  useEffect(() => {
    if (user !== null) return;
    void router.navigate(
      isSigningOut ? { to: '/login' } : { to: '/login', search: { redirect: router.state.location.href } },
    );
  }, [user, router, isSigningOut]);
}
