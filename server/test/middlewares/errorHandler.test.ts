import { describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../../src/app';
import { createUser, loginAs } from '../helpers/users';

// What Express and body-parser themselves raise on a bad request must reach the
// client as their own 4xx status, not as a 500. The handler's other branches
// are in errorHandler.unit.test.ts.

describe('errorHandler with errors raised by Express', () => {
  it('answers 400 for a malformed JSON body', async () => {
    const res = await request(app)
      .post('/account/login')
      .set('Content-Type', 'application/json')
      .send('{"email":');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: expect.any(String) });
  });

  it('answers 400 for a path param with broken percent-encoding', async () => {
    const alice = await createUser('Alice');
    const agent = await loginAs(alice);

    const res = await agent.get('/friend/search/%E0%A4%A');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: expect.any(String) });
  });
});
