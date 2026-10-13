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
 * `beforeLoad` of the `_app` layout: only signed-in users get past. Anyone else is sent to /login,
 * remembering where they were going.
 */
export async function requireUser(queryClient: QueryClient, currentHref: string): Promise<User> {
  const user = await queryClient.ensureQueryData(meQueryOptions());
  if (!user) throw redirect({ to: '/login', search: { redirect: currentHref } });
  return user;
}

/** `beforeLoad` of the `_guest` layout (login, and later signup): signed-in users have no use for these pages. */
export async function redirectIfSignedIn(queryClient: QueryClient): Promise<void> {
  const user = await queryClient.ensureQueryData(meQueryOptions());
  if (user) throw redirect({ to: DEFAULT_SIGNED_IN_PATH });
}
