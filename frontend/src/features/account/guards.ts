import { redirect } from '@tanstack/react-router';
import type { QueryClient } from '@tanstack/react-query';
import { meQueryOptions } from './queries';
import type { User } from './types';

export const DEFAULT_SIGNED_IN_PATH = '/chat';

/**
 * Where to send someone after they sign in: the page they were bounced from, but only if it is a
 * path on this site. Anything else (`https://evil.example`, `//evil.example`, `/\evil.example`,
 * which browsers read as `//evil.example`) falls back to the default, so a crafted login link
 * cannot forward people to another site.
 */
export function safeRedirectPath(target: unknown, fallback: string = DEFAULT_SIGNED_IN_PATH): string {
  if (typeof target !== 'string') return fallback;
  if (!target.startsWith('/') || target.startsWith('//') || target.startsWith('/\\')) return fallback;
  if (/[\u0000-\u001f]/.test(target)) return fallback;
  return target;
}

/**
 * Who is signed in, from the cache whenever it holds an answer, however old; the server is asked
 * only when nothing is cached yet. `staleTime: 'static'` is what keeps it that way: an answer that
 * went stale, or was invalidated, is not fetched again by a navigation (the `_app` layout's own
 * `useMe` does that), so moving between pages never waits for the network. It replaces
 * `ensureQueryData`, which behaved like this and is deprecated.
 */
function cachedMe(queryClient: QueryClient) {
  return queryClient.query({ ...meQueryOptions(), staleTime: 'static' });
}

/**
 * `beforeLoad` of the `_app` layout: only signed-in users get past. Anyone else is sent to /login,
 * remembering where they were going.
 */
export async function requireUser(queryClient: QueryClient, currentHref: string): Promise<User> {
  const user = await cachedMe(queryClient);
  if (!user) throw redirect({ to: '/login', search: { redirect: currentHref } });
  return user;
}

/** `beforeLoad` of the `_guest` layout (login, signup, forgot password): signed-in users have no use for these pages. */
export async function redirectIfSignedIn(queryClient: QueryClient): Promise<void> {
  const user = await cachedMe(queryClient);
  if (user) throw redirect({ to: DEFAULT_SIGNED_IN_PATH });
}
