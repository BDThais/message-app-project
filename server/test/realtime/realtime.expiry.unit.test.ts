import { afterEach, describe, expect, it, vi } from 'vitest';
import { closeWhenSessionEnds } from '../../src/modules/realtime/realtime.server';

// What the end-to-end test cannot see: the timer's bookkeeping, with the clock under the test's control.
function fakeSocket(expiresAt: Date) {
  let onDisconnect = () => {};
  const socket = {
    data: { expiresAt },
    disconnect: vi.fn(),
    once: vi.fn((_event: string, listener: () => void) => {
      onDisconnect = listener;
      return socket;
    }),
  };
  return {
    socket: socket as unknown as Parameters<typeof closeWhenSessionEnds>[0],
    disconnected: socket.disconnect,
    leave: () => onDisconnect(),
  };
}

afterEach(() => vi.useRealTimers());

describe('closeWhenSessionEnds', () => {
  it('disconnects the socket when the session ends, and not before', async () => {
    vi.useFakeTimers();
    const { socket, disconnected } = fakeSocket(new Date(Date.now() + 60_000));

    closeWhenSessionEnds(socket);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(disconnected).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);

    expect(disconnected).toHaveBeenCalledTimes(1);
  });

  it('disconnects at once a socket whose session has ended already', () => {
    vi.useFakeTimers();
    const { socket, disconnected } = fakeSocket(new Date(Date.now() - 1));

    closeWhenSessionEnds(socket);

    expect(disconnected).toHaveBeenCalledTimes(1);
  });

  it('waits out a session longer than a timer can: 30 days is not an instant disconnect', async () => {
    vi.useFakeTimers();
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    const { socket, disconnected } = fakeSocket(new Date(Date.now() + thirtyDays));

    closeWhenSessionEnds(socket);
    await vi.advanceTimersByTimeAsync(thirtyDays - 1_000);
    expect(disconnected).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2_000);

    expect(disconnected).toHaveBeenCalledTimes(1);
  });

  it('leaves no timer behind when the socket goes first: a session lasts a week, and the socket must not be kept for it', () => {
    vi.useFakeTimers();
    const { socket, leave, disconnected } = fakeSocket(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));

    closeWhenSessionEnds(socket);
    expect(vi.getTimerCount()).toBe(1);
    leave();

    expect(vi.getTimerCount()).toBe(0);
    expect(disconnected).not.toHaveBeenCalled();
  });
});
