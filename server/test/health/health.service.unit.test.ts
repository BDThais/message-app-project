import { afterEach, describe, expect, it, vi } from 'vitest';

const queryRaw = vi.fn();
vi.mock('../../src/lib/prisma', () => ({ prisma: { $queryRaw: queryRaw } }));

const { isDatabaseReachable } = await import('../../src/modules/health/health.service');
const { getReadiness } = await import('../../src/modules/health/health.controller');

afterEach(() => {
  vi.useRealTimers();
  queryRaw.mockReset();
});

describe('isDatabaseReachable', () => {
  it('is true when the query is answered', async () => {
    queryRaw.mockResolvedValue([{ '?column?': 1 }]);

    expect(await isDatabaseReachable()).toBe(true);
  });

  it('is false, and does not throw, when the query fails', async () => {
    queryRaw.mockRejectedValue(new Error('connection refused'));

    expect(await isDatabaseReachable()).toBe(false);
  });

  it('is false when the database does not answer in time, however long it takes', async () => {
    vi.useFakeTimers();
    queryRaw.mockReturnValue(new Promise(() => {}));

    const answer = isDatabaseReachable(2_000);
    await vi.advanceTimersByTimeAsync(2_001);

    expect(await answer).toBe(false);
  });

  it('leaves no timer behind when the database answers', async () => {
    vi.useFakeTimers();
    queryRaw.mockResolvedValue([]);

    await isDatabaseReachable();

    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('GET /api/health/ready', () => {
  it('answers 503 with the error body when the database is unreachable', async () => {
    queryRaw.mockRejectedValue(new Error('down'));
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };

    await getReadiness({} as never, res as never);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({ error: 'Database unavailable' });
  });
});
