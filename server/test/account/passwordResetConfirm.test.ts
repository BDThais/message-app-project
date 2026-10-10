import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import app from '../../src/app';
import { verifyPassword } from '../../src/lib/passwordHash';
import { prisma } from '../../src/lib/prisma';
import { tokenFromMail } from '../helpers/emailVerification';
import { outbox } from '../helpers/mailer';
import { createResetLink, createVerifiedUser } from '../helpers/passwordReset';
import { loginAs } from '../helpers/users';

// passwordResetLimiter allows 10 requests per IP in 15 minutes, and loginLimiter another 10 for
// /account/login; every test in this file shares both budgets (the limiters live as long as the
// file does). This file sends 9 requests to the reset route and 2 to login: keep it under 10. The
// rules that need many requests are tested on the service (passwordReset.service.test.ts), the bad
// bodies in the validator's unit test, and the limiter itself in passwordResetLimiter.test.ts.
const route = '/account/password/reset';
const invalidLink = { error: 'This reset link is invalid or has expired' };
const oldPassword = 'Str0ng!Pass';
const newPassword = 'N3wer!Passw0rd';

afterEach(() => {
  vi.restoreAllMocks();
});

describe(`POST ${route}`, () => {
  it('answers 400 for a new password that breaks the signup rules, and the link is not used up', async () => {
    const alice = await createVerifiedUser('Alice', oldPassword);
    const token = await createResetLink(alice);

    const weak = await request(app).post(route).send({ token, new_password: 'weak' });

    expect(weak.status).toBe(400);
    expect(weak.body).toEqual({ error: 'Password must be at least 8 characters long' });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: alice.id } })).passwordHash).toBe(alice.passwordHash);
    expect(await prisma.passwordResetToken.count({ where: { userId: alice.id } })).toBe(1);

    const retry = await request(app).post(route).send({ token, new_password: newPassword });

    expect(retry.status).toBe(204);
  });

  it('resets the password through the mailed link: signs the account out everywhere without signing it in, and mails a notice', async () => {
    const alice = await createVerifiedUser('Alice', oldPassword);
    const bob = await createVerifiedUser('Bob', oldPassword);
    const agent = await loginAs(alice);
    const other = await loginAs(alice);
    const bobAgent = await loginAs(bob);
    await request(app).post('/account/password/reset-request').send({ email: alice.email });
    const token = tokenFromMail(outbox.sent[0]!);
    outbox.clear();

    const res = await request(app).post(route).send({ token, new_password: newPassword });

    expect(res.status).toBe(204);
    expect(res.body).toEqual({});
    expect(res.headers['set-cookie']).toBeUndefined();
    const stored = (await prisma.user.findUniqueOrThrow({ where: { id: alice.id } })).passwordHash;
    expect(await verifyPassword(stored, newPassword)).toBe(true);
    expect(await prisma.session.count({ where: { userId: alice.id } })).toBe(0);
    expect((await agent.get('/account/me')).body).toEqual({ user: null });
    expect((await other.get('/account/me')).body).toEqual({ user: null });
    expect((await bobAgent.get('/account/me')).body.user).not.toBeNull();
    expect(await prisma.passwordResetToken.count({ where: { userId: alice.id } })).toBe(0);
    // The notice goes to the account's address, and says nothing secret.
    expect(outbox.sent).toHaveLength(1);
    expect(outbox.sent[0]).toMatchObject({ to: alice.email, subject: 'Your password was changed' });

    // They log in with the new password, through the login route and its limiter.
    const oldLogin = await request(app).post('/account/login').send({ email: alice.email, password: oldPassword });
    const newLogin = await request(app).post('/account/login').send({ email: alice.email, password: newPassword });
    expect(oldLogin.status).toBe(401);
    expect(newLogin.status).toBe(200);
  });

  it('works once: the same link a second time is a 400, and the password stays the one the first request set', async () => {
    const alice = await createVerifiedUser('Alice', oldPassword);
    const token = await createResetLink(alice);

    const first = await request(app).post(route).send({ token, new_password: newPassword });
    const second = await request(app).post(route).send({ token, new_password: 'An0ther!Passw0rd' });

    expect(first.status).toBe(204);
    expect(second.status).toBe(400);
    expect(second.body).toEqual(invalidLink);
    const stored = (await prisma.user.findUniqueOrThrow({ where: { id: alice.id } })).passwordHash;
    expect(await verifyPassword(stored, newPassword)).toBe(true);
  });

  it('answers 400 with one message for an unknown link and for an expired one, changes nothing, and mails nothing', async () => {
    const alice = await createVerifiedUser('Alice', oldPassword);
    const expired = await createResetLink(alice, { expiresAt: new Date(Date.now() - 1000) });

    const unknown = await request(app).post(route).send({ token: 'no-such-token', new_password: newPassword });
    const expiredRes = await request(app).post(route).send({ token: expired, new_password: newPassword });

    expect(unknown.status).toBe(400);
    expect(unknown.body).toEqual(invalidLink);
    expect(expiredRes.status).toBe(400);
    expect(expiredRes.body).toEqual(invalidLink);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: alice.id } })).passwordHash).toBe(alice.passwordHash);
    expect(outbox.sent).toEqual([]);
  });

  it('still answers 204 when the notice cannot be sent, and does not wait for it', async () => {
    const alice = await createVerifiedUser('Alice');
    const bob = await createVerifiedUser('Bob');
    const alicesToken = await createResetLink(alice);
    const bobsToken = await createResetLink(bob);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const send = vi.spyOn(outbox, 'send');

    send.mockRejectedValueOnce(new Error('provider is down'));
    const failed = await request(app).post(route).send({ token: alicesToken, new_password: newPassword });
    // A mail that never finishes: a request that waited for it would never answer.
    send.mockReturnValueOnce(new Promise<void>(() => {}));
    const hanging = await request(app).post(route).send({ token: bobsToken, new_password: newPassword });

    expect(failed.status).toBe(204);
    expect(hanging.status).toBe(204);
    expect(send).toHaveBeenCalledTimes(2);
  });
});
