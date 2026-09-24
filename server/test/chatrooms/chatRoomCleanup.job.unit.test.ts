import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startEmptyChatRoomCleanup } from '../../src/modules/chatrooms/chatRoomCleanup.job';
import { purgeExpiredEmptyChatRooms } from '../../src/modules/chatrooms/chatRoomCleanup.service';

vi.mock('../../src/modules/chatrooms/chatRoomCleanup.service', () => ({
  purgeExpiredEmptyChatRooms: vi.fn(),
}));

const purge = vi.mocked(purgeExpiredEmptyChatRooms);
const options = { retentionMs: 1000, intervalMs: 60_000 };

beforeEach(() => {
  vi.useFakeTimers();
  purge.mockReset();
  purge.mockResolvedValue({ stamped: 0, deleted: 0 });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('startEmptyChatRoomCleanup', () => {
  it('sweeps once right away, then every interval, until it is stopped', async () => {
    const stop = startEmptyChatRoomCleanup(options);
    await vi.advanceTimersByTimeAsync(0);
    expect(purge).toHaveBeenCalledTimes(1);
    expect(purge).toHaveBeenCalledWith(options.retentionMs);

    await vi.advanceTimersByTimeAsync(options.intervalMs);
    await vi.advanceTimersByTimeAsync(options.intervalMs);
    expect(purge).toHaveBeenCalledTimes(3);

    stop();
    await vi.advanceTimersByTimeAsync(options.intervalMs * 3);
    expect(purge).toHaveBeenCalledTimes(3);
  });

  it('logs a failed sweep and tries again on the next tick instead of crashing', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    purge.mockRejectedValueOnce(new Error('database is down'));

    const stop = startEmptyChatRoomCleanup(options);
    await vi.advanceTimersByTimeAsync(0);
    expect(error).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(options.intervalMs);
    expect(purge).toHaveBeenCalledTimes(2);
    expect(error).toHaveBeenCalledTimes(1);
    stop();
  });

  it('skips a tick while the previous sweep is still running', async () => {
    let finishSweep!: () => void;
    purge.mockImplementationOnce(
      () => new Promise((resolve) => (finishSweep = () => resolve({ stamped: 0, deleted: 0 })))
    );

    const stop = startEmptyChatRoomCleanup(options);
    await vi.advanceTimersByTimeAsync(options.intervalMs * 2);
    expect(purge).toHaveBeenCalledTimes(1);

    finishSweep();
    await vi.advanceTimersByTimeAsync(options.intervalMs);
    expect(purge).toHaveBeenCalledTimes(2);
    stop();
  });

  it.each([
    ['a NaN interval', { retentionMs: 1000, intervalMs: NaN }],
    ['a zero interval', { retentionMs: 1000, intervalMs: 0 }],
    ['an interval above the timer limit', { retentionMs: 1000, intervalMs: 2_147_483_648 }],
    ['a NaN retention', { retentionMs: NaN, intervalMs: 60_000 }],
    ['a negative retention', { retentionMs: -1, intervalMs: 60_000 }],
  ])('refuses to start with %s', (_label, badOptions) => {
    expect(() => startEmptyChatRoomCleanup(badOptions)).toThrow();
    expect(purge).not.toHaveBeenCalled();
  });
});
