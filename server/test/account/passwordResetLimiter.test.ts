import { describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../../src/app';

// The route's other tests are in passwordResetConfirm.test.ts. Every test starts with full rate-limit
// budgets (test/setup.ts), so this one can use up the whole of the limiter's.
describe('POST /account/password/reset (rate limit)', () => {
  it('answers 429 after 10 requests from one IP in the window, even for a link that is fine', async () => {
    for (let i = 0; i < 10; i++) {
      const res = await request(app).post('/api/account/password/reset').send({});
      expect(res.status, `request ${i + 1}`).toBe(400);
    }

    const blocked = await request(app).post('/api/account/password/reset').send({ token: 'anything', new_password: 'N3wer!Passw0rd' });

    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({ error: 'Too many attempts, try again later' });
  });
});
