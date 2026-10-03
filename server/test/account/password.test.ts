import { describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../../src/app';
import { hashPassword, verifyPassword } from '../../src/lib/passwordHash';
import { prisma } from '../../src/lib/prisma';
import { changePassword } from '../../src/modules/account/account.service';
import { createUser, loginAs } from '../helpers/users';

const route = '/account/password';
const currentPassword = 'Str0ng!Pass';
const newPassword = 'N3wer!Passw0rd';

/** A user who really has `currentPassword` (the helper's hash is a placeholder). */
async function createUserWithPassword(name: string) {
  const user = await createUser(name);
  return prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(currentPassword) } });
}

describe(`POST ${route}`, () => {
  it('returns 401 without a session', async () => {
    const res = await request(app)
      .post(route)
      .send({ current_password: currentPassword, new_password: newPassword });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Unauthorized Access' });
  });

  it('returns 400 for a new password that breaks the signup rules and changes nothing', async () => {
    const alice = await createUserWithPassword('Alice');
    const agent = await loginAs(alice);

    const res = await agent.post(route).send({ current_password: currentPassword, new_password: 'weak' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Password must be at least 8 characters long' });
    expect((await prisma.user.findUnique({ where: { id: alice.id } }))!.passwordHash).toBe(alice.passwordHash);
  });

  it('returns 401 when the current password is wrong, and changes nothing', async () => {
    const alice = await createUserWithPassword('Alice');
    const agent = await loginAs(alice);
    await loginAs(alice);

    const res = await agent.post(route).send({ current_password: 'Wrong!Pass1', new_password: newPassword });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Current password is incorrect' });
    expect((await prisma.user.findUnique({ where: { id: alice.id } }))!.passwordHash).toBe(alice.passwordHash);
    expect(await prisma.session.count({ where: { userId: alice.id } })).toBe(2);
  });

  it('returns 204, stores the new password and keeps the current session working', async () => {
    const alice = await createUserWithPassword('Alice');
    const agent = await loginAs(alice);

    const res = await agent.post(route).send({ current_password: currentPassword, new_password: newPassword });

    expect(res.status).toBe(204);
    expect(res.body).toEqual({});
    const stored = (await prisma.user.findUnique({ where: { id: alice.id } }))!.passwordHash;
    expect(await verifyPassword(stored, newPassword)).toBe(true);
    expect((await agent.get('/account/me')).body.user).toMatchObject({ id: alice.id });
  });

  it('lets the user log in with the new password and no longer with the old one', async () => {
    const alice = await createUserWithPassword('Alice');
    const agent = await loginAs(alice);
    await agent.post(route).send({ current_password: currentPassword, new_password: newPassword });

    const oldLogin = await request(app).post('/account/login').send({ email: alice.email, password: currentPassword });
    const newLogin = await request(app).post('/account/login').send({ email: alice.email, password: newPassword });

    expect(oldLogin.status).toBe(401);
    expect(newLogin.status).toBe(200);
  });

  it("deletes the user's other sessions, including expired ones, but not the current one or anyone else's", async () => {
    const alice = await createUserWithPassword('Alice');
    const bob = await createUser('Bob');
    const agent = await loginAs(alice);
    const other = await loginAs(alice);
    await prisma.session.create({ data: { userId: alice.id, expiresAt: new Date(Date.now() - 1000) } });
    const bobAgent = await loginAs(bob);

    const res = await agent.post(route).send({ current_password: currentPassword, new_password: newPassword });

    expect(res.status).toBe(204);
    expect(await prisma.session.count({ where: { userId: alice.id } })).toBe(1);
    expect((await agent.get('/account/me')).body.user).not.toBeNull();
    expect((await other.get('/account/me')).body).toEqual({ user: null });
    expect((await bobAgent.get('/account/me')).body.user).not.toBeNull();
  });

  it('answers 429 after 10 attempts in the window, counted per user', async () => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');
    const aliceAgent = await loginAs(alice);
    const bobAgent = await loginAs(bob);

    for (let i = 0; i < 10; i++) {
      const res = await aliceAgent.post(route).send({});
      expect(res.status, `attempt ${i + 1}`).toBe(400);
    }
    const blocked = await aliceAgent.post(route).send({});
    const otherUser = await bobAgent.post(route).send({});

    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({ error: 'Too many attempts, try again later' });
    expect(otherUser.status).toBe(400);
  });
});

describe('changePassword (service)', () => {
  it('writes nothing when the stored hash is no longer the one that was verified', async () => {
    const alice = await createUser('Alice');
    await loginAs(alice);
    await loginAs(alice);

    // The caller verified 'stale-hash', but another request has changed the password since.
    const changed = await changePassword(alice.id, 'stale-hash', 'new-hash', 'no-such-session');

    expect(changed).toBe(false);
    expect((await prisma.user.findUnique({ where: { id: alice.id } }))!.passwordHash).toBe(alice.passwordHash);
    expect(await prisma.session.count({ where: { userId: alice.id } })).toBe(2);
  });
});
