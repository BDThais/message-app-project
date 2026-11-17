import { afterEach, describe, expect, it, vi } from 'vitest';
import { installShutdownHandlers } from '../../src/lib/shutdown';

const stoppers: Array<() => void> = [];
function install(options: Parameters<typeof installShutdownHandlers>[0]) {
  const stop = installShutdownHandlers({ signals: ['SIGUSR2'], ...options });
  stoppers.push(stop);
  return stop;
}
const signal = () => process.emit('SIGUSR2');

afterEach(() => {
  stoppers.splice(0).forEach((stop) => stop());
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('installShutdownHandlers', () => {
  it('closes everything on the signal and leaves with 0', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const exit = vi.fn();
    const close = vi.fn().mockResolvedValue(undefined);
    install({ close, exit });

    signal();
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));

    expect(close).toHaveBeenCalledTimes(1);
  });

  it('closes once however many signals come while it is closing', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const exit = vi.fn();
    const close = vi.fn(() => new Promise<void>((resolve) => setTimeout(resolve, 20)));
    install({ close, exit });

    signal();
    signal();
    signal();
    await vi.waitFor(() => expect(exit).toHaveBeenCalled());

    expect(close).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it('leaves with 1 and says why when closing fails', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exit = vi.fn();
    install({ close: () => Promise.reject(new Error('the database would not let go')), exit });

    signal();
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));

    expect(error.mock.calls[0]?.[0]).toContain('Error while shutting down');
  });

  it('gives up with 1 when closing takes longer than the limit', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const exit = vi.fn();
    install({ close: () => new Promise<void>(() => {}), exit, timeoutMs: 5_000 });

    signal();
    await vi.advanceTimersByTimeAsync(4_999);
    expect(exit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);

    expect(exit).toHaveBeenCalledWith(1);
  });

  it('stops listening when told to', () => {
    const exit = vi.fn();
    const close = vi.fn().mockResolvedValue(undefined);
    const stop = install({ close, exit });

    stop();
    signal();

    expect(close).not.toHaveBeenCalled();
  });
});
