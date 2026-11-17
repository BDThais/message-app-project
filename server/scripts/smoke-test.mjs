// A check of a running deployment, from outside: node server/scripts/smoke-test.mjs https://chat.example.com
// It only reads (and tries to open sockets that must be refused), so it is safe against production.
// Needs `npm ci` in server/ for the socket.io client. Exit code 1 when anything fails.

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { io } = require('socket.io-client');

const base = (process.argv[2] ?? '').replace(/\/+$/, '');
if (!/^https?:\/\//.test(base)) {
  console.error('Usage: node server/scripts/smoke-test.mjs https://your-domain');
  process.exit(2);
}
const isHttps = base.startsWith('https://');

const results = [];
async function check(name, run) {
  try {
    await run();
    results.push({ name, ok: true });
    console.log(`  ok    ${name}`);
  } catch (error) {
    results.push({ name, ok: false });
    console.log(`  FAIL  ${name}\n          ${error.message}`);
  }
}
function expect(condition, message) {
  if (!condition) throw new Error(message);
}
const get = (path, init) => fetch(base + path, { redirect: 'manual', ...init });

// A socket that must be refused: resolves with the reason, rejects if it connected.
function refusedSocket(extraHeaders) {
  return new Promise((resolve, reject) => {
    const socket = io(base, { extraHeaders, reconnection: false, transports: ['websocket'], timeout: 8000 });
    socket.once('connect', () => {
      socket.close();
      reject(new Error('the socket connected, and should have been refused'));
    });
    socket.once('connect_error', (error) => {
      socket.close();
      resolve(error.message);
    });
  });
}

console.log(`Checking ${base}\n`);

await check('GET /api/health answers {"status":"ok"}', async () => {
  const res = await get('/api/health');
  expect(res.status === 200, `status ${res.status}`);
  expect((await res.json()).status === 'ok', 'unexpected body');
});

await check('GET /api/health/ready answers 200 (the database is reachable)', async () => {
  const res = await get('/api/health/ready');
  expect(res.status === 200, `status ${res.status}: the server cannot reach its database`);
});

await check('the app itself is served: / is the page, a deep link too', async () => {
  for (const path of ['/', '/chat/1', '/login']) {
    const res = await get(path);
    expect(res.status === 200, `${path}: status ${res.status}`);
    expect((await res.text()).includes('<div id="root">'), `${path}: not the app's page`);
  }
});

await check('an unknown /api path is a JSON 404, not the page', async () => {
  const res = await get('/api/definitely-not-here');
  expect(res.status === 404, `status ${res.status}`);
  expect((await res.json()).error === 'Route not found', 'unexpected body');
});

await check('an endpoint that needs a session answers 401 without one', async () => {
  const res = await get('/api/chat');
  expect(res.status === 401, `status ${res.status}`);
});

await check('security headers are set, and the server does not name its framework', async () => {
  const res = await get('/');
  expect(res.headers.get('content-security-policy'), 'no Content-Security-Policy');
  expect(res.headers.get('x-content-type-options') === 'nosniff', 'no X-Content-Type-Options');
  expect(!res.headers.get('x-powered-by'), 'X-Powered-By is sent');
  if (isHttps) expect(res.headers.get('strict-transport-security'), 'no Strict-Transport-Security');
});

await check('the session cookie is not set for a visitor', async () => {
  const res = await get('/');
  expect(!res.headers.get('set-cookie'), 'a cookie was set for a request with no session');
});

if (isHttps) {
  await check('http:// is sent to https:// (by the host)', async () => {
    const res = await fetch(base.replace('https://', 'http://'), { redirect: 'manual' });
    expect([301, 302, 307, 308].includes(res.status), `status ${res.status}`);
    expect((res.headers.get('location') ?? '').startsWith('https://'), 'not redirected to https');
  });
}

await check('a socket without a session is refused', async () => {
  const reason = await refusedSocket({});
  console.log(`          (refused: ${reason})`);
});

await check('a socket from another origin is refused even before the session is looked at', async () => {
  const reason = await refusedSocket({ origin: 'https://evil.example.com' });
  console.log(`          (refused: ${reason})`);
});

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length} of ${results.length} checks passed.`);
console.log(
  'Not checked from outside: that the rate limits count people one by one (see "Finding the right TRUST_PROXY"), and mail.',
);
process.exit(failed.length === 0 ? 0 : 1);
