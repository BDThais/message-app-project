import type { Server as HttpServer } from 'node:http';
import { parse } from 'cookie';
import { Server, type Socket } from 'socket.io';
import config from '../../config/config';
import type { ClientToServerEvents, ServerToClientEvents } from '../../contract/events';
import type { User } from '../../contract/types';
import { findSessionUser } from '../account/session.service';
import { getChatIdsOfMember } from '../chatrooms/chatMember.service';
import { setRealtimeServer } from './realtime.emitter';
import { chatRoom, sessionRoom, userRoom } from './realtime.rooms';

/** What the handshake learned about a socket's owner, kept for the life of the connection. */
export interface SocketData {
  user: User;
  sessionId: string;
}

export type RealtimeServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
type RealtimeSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

// The same text as the REST answer to a missing or dead session.
const UNAUTHORIZED = 'Unauthorized Access';

// A client sends `typing` as the person types; each one is relayed to the whole room, so one socket
// cannot make the server send more than this often.
const TYPING_MIN_INTERVAL_MS = 1_000;

/**
 * Puts Socket.io on the HTTP server and registers it with the emitter. The sockets are a notification
 * layer: nothing in here writes to the database.
 *
 * The browser reaches it on the same origin as the API (the dev proxy forwards `/socket.io`), so the
 * handshake carries the same first-party session cookie, and no CORS setting is needed.
 */
export function attachRealtime(httpServer: HttpServer): RealtimeServer {
  const io: RealtimeServer = new Server(httpServer);

  io.use(authenticate);
  io.on('connection', relayTyping);

  setRealtimeServer(io);
  return io;
}

/** Closes every socket and the server's hold on the HTTP server, and stops the emitter from sending. */
export async function closeRealtime(io: RealtimeServer): Promise<void> {
  setRealtimeServer(null);
  await io.close();
}

/**
 * The handshake: the session cookie is resolved with the same lookup as a REST request, and a
 * connection without a valid session is refused (the client gets a `connect_error`, and does not try
 * again by itself). The rooms are joined here, before the connection is announced, so the client is
 * never connected without them and misses nothing between "connected" and "in its rooms".
 */
async function authenticate(socket: RealtimeSocket, next: (error?: Error) => void): Promise<void> {
  try {
    const sessionId = parse(socket.handshake.headers.cookie ?? '')[config.SESSION_COOKIE];
    if (!sessionId) return next(new Error(UNAUTHORIZED));

    const session = await findSessionUser(sessionId);
    if (session.status !== 'valid') return next(new Error(UNAUTHORIZED));

    const { user } = session;
    socket.data.user = user;
    socket.data.sessionId = sessionId;

    // The user's room before the memberships are read: a room the person is added to from now on
    // reaches this socket through it (`socketsJoin` on the user's room), while one added before the
    // read is in the result. Read first and join after, and a room added in between would be missed.
    socket.join([userRoom(user.id), sessionRoom(sessionId)]);
    socket.join((await getChatIdsOfMember(user.id)).map(chatRoom));

    next();
  } catch (error) {
    console.error('Error in the socket handshake:', error);
    next(new Error('Internal server error'));
  }
}

/** `typing` from a socket goes to the other sockets of the room it names, if the sender is in it. */
function relayTyping(socket: RealtimeSocket): void {
  const { id, name, avatarUrl } = socket.data.user;
  const lastRelayedAt = new Map<number, number>();

  // The payload comes from the browser, so it is checked like a request body.
  socket.on('typing', (payload: unknown) => {
    const chatId = (payload as { chatId?: unknown } | null)?.chatId;
    if (typeof chatId !== 'number' || !Number.isInteger(chatId)) return;
    if (!socket.rooms.has(chatRoom(chatId))) return;

    const now = Date.now();
    if (now - (lastRelayedAt.get(chatId) ?? 0) < TYPING_MIN_INTERVAL_MS) return;
    lastRelayedAt.set(chatId, now);

    socket.to(chatRoom(chatId)).emit('typing', { chatId, user: { id, name, avatarUrl } });
  });
}
