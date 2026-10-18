import { describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../../src/app';

// The route's other tests are in passwordResetRequest.test.ts. Every test starts with full rate-limit
// budgets (test/setup.ts), so this one can use up the whole of the limiter's. Every request asks for
// another address, so the per-email limiter, which keeps its own count, never gets in the way.
describe('POST /account/password/reset-request (rate limit per IP)', () => {
  it('answers 429 after 10 requests from one IP in the window, whatever the addresses', async () => {
    for (let i = 0; i < 10; i++) {
      const res = await request(app).post('/api/account/password/reset-request').send({ email: `nobody${i}@example.com` });
      expect(res.status, `request ${i + 1}`).toBe(202);
    }

    const blocked = await request(app).post('/api/account/password/reset-request').send({ email: 'someone.else@example.com' });

    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({ error: 'Too many attempts, try again later' });
  });
});
