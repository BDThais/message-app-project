import { describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../../src/app';

// The middleware in front of the friend routes (requireUserAuth), checked once
// per route so a route added without it gets caught. What the routes do once
// the guard lets a request through is tested in the other files.

// Add new routes here so they are covered too.
const allRoutes = [
  ['get', '/api/friend'],
  ['get', '/api/friend/search/+14155552671'],
  ['post', '/api/friend/requests'],
  ['get', '/api/friend/requests'],
  ['post', '/api/friend/requests/1/accept'],
  ['delete', '/api/friend/requests/1'],
  ['delete', '/api/friend/1'],
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
