import { describe, expect, it } from 'vitest';
import { connectSocket, eventually, openSession, useRealtimeServer } from '../helpers/realtime';
import { createUser } from '../helpers/users';

// The two ways a socket could outlast what let it in: the page it was opened from, and the session it was opened with.
describe('the origin of a socket', () => {
  const allowed = 'https://chat.example.com';
  useRealtimeServer({ allowedOrigin: allowed });

  it('is checked: a page on the app origin connects, a page on any other origin is refused even with a valid cookie', async () => {
    const alice = await createUser('Alice');
    const { cookie } = await openSession(alice);

    await expect(connectSocket(cookie, { origin: allowed })).resolves.toBeDefined();
    await expect(connectSocket(cookie, { origin: 'https://evil.example.com' })).rejects.toThrow();
    await expect(connectSocket(cookie, { origin: 'https://chat.example.com.evil.example' })).rejects.toThrow();
    await expect(connectSocket(cookie, { origin: 'http://chat.example.com' })).rejects.toThrow();
  });

  it('is not required of a client that names none (not a browser): the session is what it needs', async () => {
    const alice = await createUser('Alice');
    const { cookie } = await openSession(alice);

    await expect(connectSocket(cookie)).resolves.toBeDefined();
    await expect(connectSocket()).rejects.toThrow('Unauthorized Access');
  });
});

describe('the origin of a socket when none is set (development)', () => {
  useRealtimeServer();

  it('is not checked', async () => {
    const alice = await createUser('Alice');
    const { cookie } = await openSession(alice);

    await expect(connectSocket(cookie, { origin: 'http://localhost:5174' })).resolves.toBeDefined();
  });
});

describe('a session that runs out while its socket is open', () => {
  useRealtimeServer();

  it('closes the socket at the time the session ends, and nobody else`s', async () => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');
    const short = await openSession(alice, new Date(Date.now() + 400));
    const long = await openSession(bob);
    const shortSocket = await connectSocket(short.cookie);
    const longSocket = await connectSocket(long.cookie);
    expect(shortSocket.connected).toBe(true);

    await eventually(() => expect(shortSocket.connected).toBe(false), 3_000);

    expect(longSocket.connected).toBe(true);
  });

  it('is told the server closed it, so that it asks who is signed in and does not simply reconnect', async () => {
    const alice = await createUser('Alice');
    const { cookie } = await openSession(alice, new Date(Date.now() + 300));
    const socket = await connectSocket(cookie);
    const reasons: string[] = [];
    socket.on('disconnect', (reason) => reasons.push(reason));

    await eventually(() => expect(reasons).toEqual(['io server disconnect']), 3_000);
  });
});
