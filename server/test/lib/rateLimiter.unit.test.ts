import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRateLimiter, resetRateLimiters } from '../../src/lib/rateLimiter';

// No database: a small Express app with limiters made by the factory the real routes use. That every
// test of the integration suite starts with full budgets is checked in emailVerifyLimiter.test.ts.

function appWith(...limiters: ReturnType<typeof createRateLimiter>[]) {
  const app = express();
  limiters.forEach((limiter, i) => app.get(`/${i}`, limiter, (_req, res) => res.json({ ok: true })));
  return app;
}

const limiterOf = (limit: number) =>
  createRateLimiter({ windowMs: 60 * 60 * 1000, limit, message: { error: 'Too many requests' } });

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('createRateLimiter', () => {
  it('limits like express-rate-limit does: the 429 and its message come after `limit` requests', async () => {
    const app = appWith(limiterOf(2));

    expect((await request(app).get('/0')).status).toBe(200);
    expect((await request(app).get('/0')).status).toBe(200);
    const blocked = await request(app).get('/0');

    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({ error: 'Too many requests' });
  });

  it('gives every limiter counts of its own, even when two are mounted on one app', async () => {
    const app = appWith(limiterOf(1), limiterOf(1));

    expect((await request(app).get('/0')).status).toBe(200);
    expect((await request(app).get('/0')).status).toBe(429);
    expect((await request(app).get('/1')).status).toBe(200); // the other limiter was not used up
  });
});

describe('resetRateLimiters', () => {
  it('gives every limiter its full budget back', async () => {
    const app = appWith(limiterOf(1), limiterOf(1));
    await request(app).get('/0');
    await request(app).get('/1');
    expect((await request(app).get('/0')).status).toBe(429);
    expect((await request(app).get('/1')).status).toBe(429);

    await resetRateLimiters();

    expect((await request(app).get('/0')).status).toBe(200);
    expect((await request(app).get('/1')).status).toBe(200);
  });

  it('refuses to run outside a test run, so it cannot lift a limit by mistake', async () => {
    vi.stubEnv('NODE_ENV', 'production');

    await expect(resetRateLimiters()).rejects.toThrow('tests only');
  });
});
