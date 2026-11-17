import type { Server as HttpServer } from 'node:http';
import { parse } from 'cookie';
import { Server, type Socket } from 'socket.io';
import config from '../../config/config';
import type { ClientToServerEvents, ServerToClientEvents } from '../../contract/events';
import type { User } from '../../contract/types';
import { MAX_INT32 as MAX_TIMER_DELAY_MS } from '../../lib/constants';
import { findSessionUser } from '../account/session.service';
import { getChatIdsOfMember } from '../chatrooms/chatMember.service';
import { setRealtimeServer } from './realtime.emitter';
import { chatRoom, sessionRoom, userRoom } from './realtime.rooms';

/** What the handshake learned about a socket's owner, kept for the life of the connection. */
export interface SocketData {
  user: User;
  sessionId: string;
  expiresAt: Date;
}

export type RealtimeServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
type RealtimeSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

// The same text as the REST answer to a missing or dead session.
const UNAUTHORIZED = 'Unauthorized Access';

// A client sends `typing` as the person types; each one is relayed to the whole room, so one socket
// cannot make the server send more than this often.
const TYPING_MIN_INTERVAL_MS = 1_000;

export interface RealtimeOptions {
  /**
   * The one origin a browser may open a socket from (see APP_ORIGIN). A handshake that names another
   * origin is refused; one that names none (not a browser) is let through to the session check, which
   * needs a cookie that only a browser on this site holds. Unset: no origin is checked (development).
   */
  allowedOrigin?: string | undefined;
}

/**
 * Puts Socket.io on the HTTP server and registers it with the emitter. The sockets are a notification
 * layer: nothing in here writes to the database.
 *
 * The browser reaches it on the same origin as the API (the dev proxy forwards `/socket.io`), so the
 * handshake carries the same first-party session cookie, and no CORS setting is needed. A WebSocket
 * handshake is not subject to CORS, though: a page on another origin of the same site can open one
 * and the browser sends the cookie along (`SameSite=Lax` only stops other sites), so the origin is checked here.
 */
export function attachRealtime(httpServer: HttpServer, { allowedOrigin }: RealtimeOptions = {}): RealtimeServer {
  const io: RealtimeServer = new Server(httpServer, {
    allowRequest: (req, callback) => {
      const { origin } = req.headers;
      callback(null, allowedOrigin === undefined || origin === undefined || origin === allowedOrigin);
    },
  });

  io.use(authenticate);
  io.on('connection', (socket) => {
    relayTyping(socket);
    closeWhenSessionEnds(socket);
  });

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
    socket.data.expiresAt = session.expiresAt;

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

/**
 * A session ends by itself when it expires, and the socket opened with it must end then: it was
 * checked once, at the handshake. The client sees `io server disconnect`, asks who is signed in and
 * leaves for the login page. (A timer cannot wait longer than about 24.8 days, so it is set again until the time has come.)
 * Exported for its unit test.
 */
export function closeWhenSessionEnds(socket: Pick<RealtimeSocket, 'data' | 'disconnect' | 'once'>): void {
  let timer: NodeJS.Timeout | undefined;

  const wait = () => {
    const left = socket.data.expiresAt.getTime() - Date.now();
    if (left <= 0) return void socket.disconnect();
    timer = setTimeout(wait, Math.min(left, MAX_TIMER_DELAY_MS));
    timer.unref();
  };

  wait();
  socket.once('disconnect', () => clearTimeout(timer));
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
