import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { io as connect, type Socket } from 'socket.io-client';
import { afterEach, beforeEach } from 'vitest';
import app from '../../src/app';
import config from '../../src/config/config';
import type { ClientToServerEvents, ServerToClientEvents } from '../../src/contract/events';
import { attachRealtime, closeRealtime, type RealtimeServer } from '../../src/modules/realtime/realtime.server';
import { createSessionRow } from './users';

export type TestSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/** An event a socket received: what it was called, and what it carried. */
export interface Received {
  event: string;
  payload: unknown;
}

let httpServer: HttpServer;
let realtime: RealtimeServer;
const opened: TestSocket[] = [];

/** The real HTTP server with Socket.io on it, on a free port, for the test that calls this inside `describe`. */
export function useRealtimeServer() {
  beforeEach(async () => {
    httpServer = createServer(app);
    realtime = attachRealtime(httpServer);
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  });

  afterEach(async () => {
    for (const socket of opened.splice(0)) socket.disconnect();
    await closeRealtime(realtime);
  });

  return { io: () => realtime };
}

/** A login session for `user`, and an agent that speaks REST with its cookie, the way a browser tab does. */
export async function openSession(user: { id: number }, expiresAt = new Date(Date.now() + 60 * 60 * 1000)) {
  const session = await createSessionRow(user.id, expiresAt);
  const cookie = `${config.SESSION_COOKIE}=${session.id}`;

  return { sessionId: session.id, cookie, agent: request.agent(app).set('Cookie', cookie) };
}

/**
 * Opens a socket with this cookie (none: no cookie header) and waits for the handshake. It rejects with
 * the server's `connect_error`, whose `message` is the reason. Every event it receives from then on is
 * in `received`.
 */
export function connectSocket(cookie?: string): Promise<TestSocket & { received: Received[] }> {
  const { port } = httpServer.address() as AddressInfo;
  const socket = connect(`http://localhost:${port}`, {
    // No polling: the Node client sends the cookie header on a WebSocket too (`extraHeaders`), and a
    // test does not wait for an upgrade.
    transports: ['websocket'],
    reconnection: false,
    ...(cookie === undefined ? {} : { extraHeaders: { cookie } }),
  }) as TestSocket & { received: Received[] };
  socket.received = [];
  socket.onAny((event: string, payload: unknown) => socket.received.push({ event, payload }));
  opened.push(socket);

  return new Promise((resolve, reject) => {
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
}

/** Waits until `check` stops throwing, so a test needs no fixed sleep for something that must happen. */
export async function eventually<T>(check: () => T, timeoutMs = 2_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return check();
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
}

/** What a socket received under this name, in order. */
export function payloadsOf(socket: { received: Received[] }, event: string): unknown[] {
  return socket.received.filter((entry) => entry.event === event).map((entry) => entry.payload);
}

/**
 * Gives the server time to send what it is going to send, for a test that says an event did NOT
 * arrive. The server answered the request before this, and an emit is synchronous with it, so the
 * wait is for the network only.
 */
export const settle = (ms = 150) => new Promise((resolve) => setTimeout(resolve, ms));
