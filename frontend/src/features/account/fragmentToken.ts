import { useEffect, useState } from 'react';
import { useRouter } from '@tanstack/react-router';

/**
 * Reads `token` out of a URL fragment such as `#token=abc`. The mails the server sends link to
 * `...#token=<token>`: a fragment never reaches a server log or a `Referer` header. `null` when
 * the token is missing or empty.
 */
export function parseFragmentToken(hash: string): string | null {
  const token = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash).get('token');
  return token ? token : null;
}

/**
 * The token from the page's URL fragment, read once. The fragment is taken out of the address bar
 * (and out of the browser's history entry) right away, so the token is not left in a screen share,
 * a bookmark or the history; the token itself stays in this component's state.
 */
export function useFragmentToken(): string | null {
  const router = useRouter();
  // The initializer reads the fragment while rendering, before the effect below removes it.
  const [token] = useState(() => parseFragmentToken(router.state.location.hash));

  useEffect(() => {
    const { pathname, searchStr, hash } = router.state.location;
    if (hash !== '') router.history.replace(`${pathname}${searchStr}`);
  }, [router]);

  return token;
}
