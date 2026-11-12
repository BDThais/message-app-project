import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@contract/events';

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/**
 * The connection to the server. It is made but not opened: the signed-in layout opens it (`connect()`)
 * and closes it again on sign-out, because the handshake needs a session. No URL: it goes to the page's own origin
 * (in development the Vite proxy forwards `/socket.io`), so the handshake carries the same first-party cookie as the
 * API calls.
 */
export function createSocket(): AppSocket {
  return io({ autoConnect: false });
}

/**
 * Listens to several events at once and returns the function that stops. `lib/` only makes the
 * connection: what an event does to the cache is written by the features, which pass their handlers here.
 */
export function subscribe(socket: AppSocket, handlers: Partial<ServerToClientEvents>): () => void {
  // The cast is the one place the per-event handler types are lost: `Object.entries` cannot keep the link between a key and its function.
  const entries = Object.entries(handlers) as Array<[keyof ServerToClientEvents, (...args: never[]) => void]>;
  for (const [event, handler] of entries) socket.on(event, handler as never);
  return () => {
    for (const [event, handler] of entries) socket.off(event, handler as never);
  };
}
