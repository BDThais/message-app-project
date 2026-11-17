import request from 'supertest';
import { describe, expect, it } from 'vitest';
import app from '../../src/app';

describe('GET /api/health and /api/health/ready', () => {
  it('answers 200 to both without a session, and sets no cookie', async () => {
    for (const url of ['/api/health', '/api/health/ready']) {
      const res = await request(app).get(url);

      expect(res.status, url).toBe(200);
      expect(res.body, url).toEqual({ status: 'ok' });
      expect(res.headers['set-cookie'], url).toBeUndefined();
    }
  });

  it('is not limited: a host asks every few seconds', async () => {
    for (let i = 0; i < 60; i++) {
      expect((await request(app).get('/api/health')).status).toBe(200);
    }
  });
});
