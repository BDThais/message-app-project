import type { RouterHistory } from '@tanstack/react-router';
import { accountKeys } from '@/features/account/queries';
import { createQueryClient } from '@/lib/queryClient';
import { createAppRouter } from './router';

/**
 * Builds the query client and the router and connects them. Used by main.tsx, and by the tests
 * (with an in-memory `history`) so they run the same wiring as the real app. `App` renders the result.
 */
export function createApp({ history }: { history?: RouterHistory } = {}) {
  const queryClient = createQueryClient({
    // A request answered 401: find out whether the session is really gone. GET /api/account/me answers
    // `user: null` if it is, and the _app layout then redirects to /login.
    onUnauthorized: () => void queryClient.invalidateQueries({ queryKey: accountKeys.me() }),
  });
  const router = createAppRouter(queryClient, history);

  return { queryClient, router };
}
