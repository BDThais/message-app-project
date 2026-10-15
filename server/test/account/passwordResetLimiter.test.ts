import { describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../../src/app';

// In a file of its own because the limiter keeps its count for as long as the module is loaded,
// and this test uses up the whole budget (see the note in passwordResetConfirm.test.ts).
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
