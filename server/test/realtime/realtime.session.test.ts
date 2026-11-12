import { describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../../src/app';
import { hashPassword } from '../../src/lib/passwordHash';
import { prisma } from '../../src/lib/prisma';
import { connectSocket, eventually, openSession, settle, useRealtimeServer } from '../helpers/realtime';
import { createResetLink, createVerifiedUser } from '../helpers/passwordReset';

useRealtimeServer();

const password = 'Str0ng!Pass';
const newPassword = 'N3wer!Passw0rd';

// A socket lives as long as the session it was opened with; these are the ways a session ends.
async function withPassword(name: string) {
  const user = await createVerifiedUser(name);
  return prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(password) } });
}

describe('sockets and the end of a session', () => {
  it("closes the signed-out session's sockets and leaves the person's other session alone", async () => {
    const alice = await withPassword('Alice');
    const first = await openSession(alice);
    const second = await openSession(alice);
    const firstSocket = await connectSocket(first.cookie);
    const firstOtherTab = await connectSocket(first.cookie);
    const secondSocket = await connectSocket(second.cookie);

    await first.agent.post('/api/account/logout').expect(200);

    await eventually(() => expect([firstSocket.connected, firstOtherTab.connected]).toEqual([false, false]));
    await settle();
    expect(secondSocket.connected).toBe(true);
  });

  it('closes the sockets of every other session when the password is changed, and keeps the one that changed it', async () => {
    const alice = await withPassword('Alice');
    const current = await openSession(alice);
    const other = await openSession(alice);
    const currentSocket = await connectSocket(current.cookie);
    const otherSocket = await connectSocket(other.cookie);

    await current.agent
      .post('/api/account/password')
      .send({ current_password: password, new_password: newPassword })
      .expect(204);

    await eventually(() => expect(otherSocket.connected).toBe(false));
    await settle();
    expect(currentSocket.connected).toBe(true);
  });

  it('keeps every socket when the password change was refused', async () => {
    const alice = await withPassword('Alice');
    const current = await openSession(alice);
    const other = await openSession(alice);
    const otherSocket = await connectSocket(other.cookie);

    await current.agent
      .post('/api/account/password')
      .send({ current_password: 'Wrong!Pass1', new_password: newPassword })
      .expect(401);

    await settle();
    expect(otherSocket.connected).toBe(true);
  });

  it('closes every socket of the account when it is deleted, and nobody else`s', async () => {
    const alice = await withPassword('Alice');
    const bob = await withPassword('Bob');
    const a = await openSession(alice);
    const aliceSocket = await connectSocket(a.cookie);
    const aliceOtherTab = await connectSocket((await openSession(alice)).cookie);
    const bobSocket = await connectSocket((await openSession(bob)).cookie);

    await a.agent.delete('/api/account/me').send({ password }).expect(204);

    await eventually(() => expect([aliceSocket.connected, aliceOtherTab.connected]).toEqual([false, false]));
    await settle();
    expect(bobSocket.connected).toBe(true);
  });

  it('keeps the sockets when the deletion was refused (a wrong password)', async () => {
    const alice = await withPassword('Alice');
    const a = await openSession(alice);
    const aliceSocket = await connectSocket(a.cookie);

    await a.agent.delete('/api/account/me').send({ password: 'Wrong!Pass1' }).expect(401);

    await settle();
    expect(aliceSocket.connected).toBe(true);
  });

  it('closes every socket of the account when the password is reset through the mailed link', async () => {
    const alice = await withPassword('Alice');
    const bob = await withPassword('Bob');
    const aliceSocket = await connectSocket((await openSession(alice)).cookie);
    const bobSocket = await connectSocket((await openSession(bob)).cookie);
    const token = await createResetLink(alice);

    await request(app).post('/api/account/password/reset').send({ token, new_password: newPassword }).expect(204);

    await eventually(() => expect(aliceSocket.connected).toBe(false));
    await settle();
    expect(bobSocket.connected).toBe(true);
  });

  it('does not let a closed socket back in: the same cookie is refused at the next handshake', async () => {
    const alice = await withPassword('Alice');
    const a = await openSession(alice);
    const socket = await connectSocket(a.cookie);
    await a.agent.post('/api/account/logout').expect(200);
    await eventually(() => expect(socket.connected).toBe(false));

    await expect(connectSocket(a.cookie)).rejects.toThrow('Unauthorized Access');
  });
});
