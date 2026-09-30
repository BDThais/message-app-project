import { describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../../src/app';

// The middleware in front of the friend routes (requireUserAuth), checked once
// per route so a route added without it gets caught. What the routes do once
// the guard lets a request through is tested in the other files.

// Add new routes here (e.g. GET /friend, the /friend/requests routes) so they are covered too.
const allRoutes = [
  ['get', '/friend/search/+14155552671'],
  ['post', '/friend/requests'],
] as const;

describe('every friend route', () => {
  it('rejects a request without a session', async () => {
    for (const [method, path] of allRoutes) {
      const res = await request(app)[method](path);

      expect(res.status, `${method.toUpperCase()} ${path}`).toBe(401);
      expect(res.body).toEqual({ error: 'Unauthorized Access' });
    }
  });
});
