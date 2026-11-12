import { describe, expect, it, vi } from 'vitest';
import { subscribe, type AppSocket } from '@/lib/socket';

// `subscribe` is the one place that loses the types of the handlers, so what it must do is checked here
// with a socket that only remembers who listens.
function recordingSocket() {
  const listeners = new Map<string, Set<unknown>>();
  const socket = {
    on: (event: string, listener: unknown) =>
      void (listeners.get(event) ?? listeners.set(event, new Set()).get(event))!.add(listener),
    off: (event: string, listener: unknown) => void listeners.get(event)?.delete(listener),
  };
  return { socket: socket as unknown as AppSocket, listeners };
}

describe('subscribe', () => {
  it('listens to every event it is given, with the very function that was given', () => {
    const { socket, listeners } = recordingSocket();
    const onNew = vi.fn();
    const onRemoved = vi.fn();

    subscribe(socket, { 'message:new': onNew, 'chat:removed': onRemoved });

    expect([...listeners.get('message:new')!]).toEqual([onNew]);
    expect([...listeners.get('chat:removed')!]).toEqual([onRemoved]);
  });

  it('returns the function that takes exactly those listeners away, and leaves the others', () => {
    const { socket, listeners } = recordingSocket();
    const mine = vi.fn();
    const someoneElses = vi.fn();
    socket.on('message:new', someoneElses as never);

    const stop = subscribe(socket, { 'message:new': mine });
    expect(listeners.get('message:new')?.size).toBe(2);
    stop();

    expect([...listeners.get('message:new')!]).toEqual([someoneElses]);
  });
});
