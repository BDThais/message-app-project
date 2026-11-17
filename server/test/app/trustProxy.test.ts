import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app';

// The one setting a deployment can get silently wrong: how many proxies stand in front of the server.
// The login limiter (10 attempts per 15 minutes per address) shows what each value does to people.
const attempt = (app: ReturnType<typeof createApp>, forwardedFor: string) =>
  request(app)
    .post('/api/account/login')
    .set('X-Forwarded-For', forwardedFor)
    .send({ email: 'nobody@example.com', password: 'Str0ng!Pass' });

async function useUp(app: ReturnType<typeof createApp>, forwardedFor: string) {
  for (let i = 0; i < 10; i++) expect((await attempt(app, forwardedFor)).status).not.toBe(429);
}

afterEach(() => vi.restoreAllMocks());

describe('trust proxy', () => {
  it('gives every person behind one proxy a budget of their own when it counts the proxy', async () => {
    const app = createApp({ trustProxy: 1 });
    await useUp(app, '203.0.113.1');

    expect((await attempt(app, '203.0.113.1')).status).toBe(429);
    expect((await attempt(app, '203.0.113.2')).status).not.toBe(429);
  });

  it('cannot be talked out of the limit by what the client writes in front of the address the proxy added', async () => {
    const app = createApp({ trustProxy: 1 });
    await useUp(app, '203.0.113.1');

    expect((await attempt(app, '198.51.100.9, 203.0.113.1')).status).toBe(429);
    expect((await attempt(app, '198.51.100.10, 203.0.113.1')).status).toBe(429);
  });

  it('puts everybody into one budget when the proxy is not counted: the failure TRUST_PROXY is there to prevent', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {}); // express-rate-limit complains about the header, rightly
    const app = createApp();
    await useUp(app, '203.0.113.1');

    expect((await attempt(app, '203.0.113.2')).status).toBe(429);
  });

  it('counts two proxies when told so: the address before the last proxy is the client', async () => {
    const app = createApp({ trustProxy: 2 });
    await useUp(app, '203.0.113.1, 192.0.2.50');

    expect((await attempt(app, '203.0.113.1, 192.0.2.51')).status).toBe(429);
    expect((await attempt(app, '203.0.113.2, 192.0.2.50')).status).not.toBe(429);
  });
});

describe('the client address check (LOG_CLIENT_IP)', () => {
  it('logs what Express made of the address and what it was made from, for the first requests only', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const app = createApp({ trustProxy: 1, logClientIp: true });

    for (let i = 0; i < 12; i++)
      await request(app).get('/api/health').set('X-Forwarded-For', '198.51.100.9, 203.0.113.7');

    const lines = log.mock.calls.map(([line]) => String(line)).filter((line) => line.startsWith('client ip check'));
    expect(lines).toHaveLength(10);
    expect(lines[0]).toContain('req.ip=203.0.113.7');
    expect(lines[0]).toContain('x-forwarded-for="198.51.100.9, 203.0.113.7"');
  });

  it('is silent unless it is switched on', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    await request(createApp({ trustProxy: 1 })).get('/api/health');

    expect(log).not.toHaveBeenCalled();
  });
});
