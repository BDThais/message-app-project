import { describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../../src/app';

// The route's other tests are in emailVerify.test.ts. Every test starts with full rate-limit
// budgets (test/setup.ts), so the first test can use up the whole of this limiter's and the second
// shows that the next one gets it back: it has to stay after the first.
describe('POST /account/email/verify (rate limit)', () => {
  it('answers 429 after 10 requests from one IP in the window, even for a token that is fine', async () => {
    for (let i = 0; i < 10; i++) {
      const res = await request(app).post('/api/account/email/verify').send({});
      expect(res.status, `request ${i + 1}`).toBe(400);
    }

    const blocked = await request(app).post('/api/account/email/verify').send({ token: 'anything' });

    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({ error: 'Too many attempts, try again later' });
  });

  it('starts every test with a full budget: the one before used up all 10 and this request still gets through', async () => {
    const res = await request(app).post('/api/account/email/verify').send({});

    expect(res.status).toBe(400);
  });
});
