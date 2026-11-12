import type { RouterHistory } from '@tanstack/react-router';
import { accountKeys } from '@/features/account/queries';
import { createQueryClient } from '@/lib/queryClient';
import { createSocket, type AppSocket } from '@/lib/socket';
import { createAppRouter } from './router';

/**
 * Builds the query client, the router and the socket and connects them. Used by main.tsx, and by the tests
 * (with an in-memory `history` and a fake `socket`) so they run the same wiring as the real app. `App`
 * renders the result. The socket is not open yet: the signed-in layout opens it.
 */
export function createApp({ history, socket = createSocket() }: { history?: RouterHistory; socket?: AppSocket } = {}) {
  const queryClient = createQueryClient({
    // A request answered 401: find out whether the session is really gone. GET /api/account/me answers
    // `user: null` if it is, and the _app layout then redirects to /login.
    onUnauthorized: () => void queryClient.invalidateQueries({ queryKey: accountKeys.me() }),
  });
  const router = createAppRouter(queryClient, history);

  return { queryClient, router, socket };
}
