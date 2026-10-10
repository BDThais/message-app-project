import { describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../../src/app';

// In a file of its own because the limiter keeps its count for as long as the module is loaded,
// and this test uses up the whole budget (see the note in passwordResetRequest.test.ts). Every
// request asks for another address, so the per-email limiter, which keeps its own count, never
// gets in the way.
describe('POST /account/password/reset-request (rate limit per IP)', () => {
  it('answers 429 after 10 requests from one IP in the window, whatever the addresses', async () => {
    for (let i = 0; i < 10; i++) {
      const res = await request(app).post('/account/password/reset-request').send({ email: `nobody${i}@example.com` });
      expect(res.status, `request ${i + 1}`).toBe(202);
    }

    const blocked = await request(app).post('/account/password/reset-request').send({ email: 'someone.else@example.com' });

    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({ error: 'Too many attempts, try again later' });
  });
});
