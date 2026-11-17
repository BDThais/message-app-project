import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';

// The built frontend, served by the same app as the API: a folder shaped like Vite's output.
let dist: string;
beforeAll(() => {
  dist = mkdtempSync(path.join(tmpdir(), 'frontend-dist-'));
  mkdirSync(path.join(dist, 'assets'));
  writeFileSync(path.join(dist, 'index.html'), '<!doctype html><div id="root"></div>');
  writeFileSync(path.join(dist, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  writeFileSync(path.join(dist, 'assets', 'index-abc123.js'), 'console.log("app")');
});

describe('serving the frontend', () => {
  it('answers a screen of the app, however deep, with index.html that is asked about every time', async () => {
    const app = createApp({ frontendDist: dist });

    for (const url of ['/', '/chat', '/chat/3?members=true', '/verify-email']) {
      const res = await request(app).get(url);
      expect(res.status, url).toBe(200);
      expect(res.text, url).toContain('<div id="root">');
      expect(res.headers['cache-control'], url).toBe('no-cache');
      expect(res.headers['content-type'], url).toMatch(/text\/html/);
    }
  });

  it('lets a browser keep the hashed files of assets/ for a year, and asks about the others every time', async () => {
    const app = createApp({ frontendDist: dist });

    const asset = await request(app).get('/assets/index-abc123.js');
    expect(asset.status).toBe(200);
    expect(asset.headers['cache-control']).toBe('public, max-age=31536000, immutable');

    const icon = await request(app).get('/favicon.svg');
    expect(icon.status).toBe(200);
    expect(icon.headers['cache-control']).toBe('no-cache');
  });

  it('answers a missing file with a 404, not with a page of HTML where the browser expected a script', async () => {
    const app = createApp({ frontendDist: dist });

    const res = await request(app).get('/assets/index-gone.js');

    expect(res.status).toBe(404);
    expect(res.text).not.toContain('<div id="root">');
  });

  it('keeps the API apart: an /api path no route answers is the JSON 404, and the endpoints answer as before', async () => {
    const app = createApp({ frontendDist: dist });

    const unknown = await request(app).get('/api/nothing-here');
    expect(unknown.status).toBe(404);
    expect(unknown.body).toEqual({ error: 'Route not found' });
    expect((await request(app).get('/api/chat')).status).toBe(401); // an endpoint, not the page
    expect((await request(app).get('/api/health')).body).toEqual({ status: 'ok' });
  });

  it('does not answer a request that is not a read with the page: a POST to an unknown path is a 404', async () => {
    const res = await request(createApp({ frontendDist: dist })).post('/chat');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Route not found' });
  });

  it('does not serve anything without a folder (the development setup): the JSON 404 for every unknown path', async () => {
    const res = await request(createApp()).get('/chat');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Route not found' });
  });

  it('cannot be asked for a file outside the folder', async () => {
    const secret = path.join(path.dirname(dist), `secret-${path.basename(dist)}.txt`);
    writeFileSync(secret, 'the secret');
    const app = createApp({ frontendDist: dist });

    for (const url of [
      `/%2e%2e/${path.basename(secret)}`,
      `/..%2f${path.basename(secret)}`,
      `/assets/..%2f..%2f${path.basename(secret)}`,
    ]) {
      const res = await request(app).get(url);

      expect(res.text, url).not.toContain('the secret');
      expect(res.status, url).toBe(404);
    }
  });
});

describe('security headers', () => {
  it('are on every answer, the JSON ones too, and the server does not say what it runs on', async () => {
    const res = await request(createApp({ appOrigin: 'https://chat.example.com' })).get('/api/health');

    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['strict-transport-security']).toBe('max-age=15552000');
  });

  it('allow scripts only from the page itself, any https image (avatars) and the origin as a socket address', async () => {
    const res = await request(createApp({ appOrigin: 'https://chat.example.com' })).get('/api/health');
    const csp = String(res.headers['content-security-policy']);

    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("img-src 'self' data: https:");
    expect(csp).toContain("connect-src 'self' wss://chat.example.com");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).not.toContain('upgrade-insecure-requests');
  });

  it('name no socket address when there is no origin (development)', async () => {
    const csp = String((await request(createApp()).get('/api/health')).headers['content-security-policy']);

    expect(csp).toMatch(/connect-src 'self'(;|$)/);
  });
});
