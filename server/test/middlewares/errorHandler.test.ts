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
      .post('/api/account/login')
      .set('Content-Type', 'application/json')
      .send('{"email":');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: expect.any(String) });
  });

  it('answers 400 for a path param with broken percent-encoding', async () => {
    const alice = await createUser('Alice');
    const agent = await loginAs(alice);

    const res = await agent.get('/api/friend/search/%E0%A4%A');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: expect.any(String) });
  });
});

// A request no route serves gets the API's own error body, not Express's HTML page.
// Under /api/chat and /api/friend the session check runs first.
describe('notFoundHandler for paths no route serves', () => {
  it('answers 404 with the error body for an unknown path', async () => {
    const res = await request(app).get('/nope');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Route not found' });
  });

  it('answers 404 for an API path without the /api prefix', async () => {
    const res = await request(app).get('/account/me');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Route not found' });
  });

  it('answers 404 for an unknown path under /api/account, which has no session check of its own', async () => {
    const res = await request(app).get('/api/account/nope');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Route not found' });
  });

  it('answers 404 under a protected router when signed in, for an unknown path and for a method the path does not have', async () => {
    const alice = await createUser('Alice');
    const agent = await loginAs(alice);

    const unknownPath = await agent.get('/api/friend/nope');
    const unknownMethod = await agent.put('/api/chat');

    expect(unknownPath.status).toBe(404);
    expect(unknownPath.body).toEqual({ error: 'Route not found' });
    expect(unknownMethod.status).toBe(404);
    expect(unknownMethod.body).toEqual({ error: 'Route not found' });
  });

  it('keeps answering 401 under a protected router when signed out', async () => {
    const res = await request(app).get('/api/friend/nope');

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Unauthorized Access' });
  });
});
