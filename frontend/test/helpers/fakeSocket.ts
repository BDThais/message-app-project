import { act } from '@testing-library/react';
import type { ServerToClientEvents } from '@contract/events';
import type { AppSocket } from '@/lib/socket';

type Listener = (...args: unknown[]) => void;

/**
 * Stands in for the socket.io client in the app-level tests: no network, and the test plays the
 * server. The app sees the part of the real socket's interface it uses (`on`, `off`, `emit`,
 * `connect`, `disconnect`, `connected`, `active`); the rest is the test's controls.
 */
export class FakeSocket {
  connected = false;
  /** True while the real client would try again by itself; false after a refused handshake or a close by the server. */
  active = true;
  /** How many times the app opened and closed the connection. */
  opened = 0;
  closed = 0;
  /** What the app sent to the server. */
  readonly sent: Array<{ event: string; payload: unknown }> = [];
  private readonly listeners = new Map<string, Set<Listener>>();

  on(event: string, listener: Listener): this {
    const listeners = this.listeners.get(event) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(event, listeners);
    return this;
  }

  off(event: string, listener: Listener): this {
    this.listeners.get(event)?.delete(listener);
    return this;
  }

  emit(event: string, payload?: unknown): this {
    this.sent.push({ event, payload });
    return this;
  }

  /** The handshake succeeds at once. (The real client is asynchronous, which no test depends on.) */
  connect(): this {
    this.opened += 1;
    this.active = true;
    this.connected = true;
    this.fire('connect');
    return this;
  }

  disconnect(): this {
    this.closed += 1;
    if (this.connected) {
      this.connected = false;
      this.fire('disconnect', 'io client disconnect');
    }
    return this;
  }

  listenerCount(event: string): number {
    return this.listeners.get(event)?.size ?? 0;
  }

  /** What the app sent under this name. */
  sentPayloads(event: string): unknown[] {
    return this.sent.filter((entry) => entry.event === event).map((entry) => entry.payload);
  }

  // The controls: what the server does.

  /** The server sends an event. */
  serverSends<E extends keyof ServerToClientEvents>(event: E, ...payload: Parameters<ServerToClientEvents[E]>): void {
    act(() => this.fire(event, ...payload));
  }

  /** The connection is lost; the real client would try again. */
  dropConnection(): void {
    this.connected = false;
    act(() => this.fire('disconnect', 'transport close'));
  }

  /** The connection is back: a `connect` event, as after any reconnect. */
  reconnect(): void {
    this.connected = true;
    act(() => this.fire('connect'));
  }

  /** The server closes the socket (its session ended): the real client does not try again. */
  serverCloses(): void {
    this.connected = false;
    this.active = false;
    act(() => this.fire('disconnect', 'io server disconnect'));
  }

  /** The handshake is refused (no valid session): the real client does not try again. */
  refuseHandshake(): void {
    this.active = false;
    act(() => this.fire('connect_error', new Error('Unauthorized Access')));
  }

  asAppSocket(): AppSocket {
    return this as unknown as AppSocket;
  }

  private fire(event: string, ...args: unknown[]): void {
    for (const listener of [...(this.listeners.get(event) ?? [])]) listener(...args);
  }
}
