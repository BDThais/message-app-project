import type { QueryClient } from '@tanstack/react-query';
import { subscribe, type AppSocket } from '@/lib/socket';
import { friendKeys } from './keys';

/**
 * The friend lists and the two request lists, as stale: they are asked for again if the friends page
 * is showing them, and otherwise when it is opened. Not the searches: `friendKeys.all()` would include
 * them, and a search is limited and counts every request, so only pressing Search sends one.
 */
function invalidateFriendLists(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: friendKeys.list() });
  void queryClient.invalidateQueries({ queryKey: friendKeys.requests('incoming') });
  void queryClient.invalidateQueries({ queryKey: friendKeys.requests('outgoing') });
}

/** Somebody sent the person a request, or accepted theirs. Returns the function that stops listening. */
export function attachFriendEvents(socket: AppSocket, queryClient: QueryClient): () => void {
  return subscribe(socket, {
    'friend:request': () => invalidateFriendLists(queryClient),
    'friend:accepted': () => invalidateFriendLists(queryClient),
  });
}

/** After a reconnect: what was missed while the socket was down. */
export function resyncFriends(queryClient: QueryClient): void {
  invalidateFriendLists(queryClient);
}
