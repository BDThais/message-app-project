import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import app from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { hashToken } from '../../src/lib/randomToken';
import { RESEND_COOLDOWN_MS, verifyEmailToken } from '../../src/modules/account/emailVerification.service';
import { createVerificationLink, tokenFromMail } from '../helpers/emailVerification';
import { outbox } from '../helpers/mailer';
import { createUser, loginAs } from '../helpers/users';

const route = '/account/email/verification';

afterEach(() => {
  vi.restoreAllMocks();
});

describe(`POST ${route}`, () => {
  it('returns 401 without a session, and sends nothing', async () => {
    const res = await request(app).post(route).send();

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Unauthorized Access' });
    expect(outbox.sent).toEqual([]);
  });

  it('mails a working link to the account\'s own address, for an account that has no link yet', async () => {
    // Accounts that existed before email verification start like this: unverified, no link.
    const alice = await createUser('Alice');
    const agent = await loginAs(alice);

    const res = await agent.post(route).send();

    expect(res.status).toBe(204);
    expect(res.body).toEqual({});
    expect(outbox.sent).toHaveLength(1);
    expect(outbox.sent[0].to).toBe(alice.email);
    const token = tokenFromMail(outbox.sent[0]);
    const stored = await prisma.emailVerificationToken.findUniqueOrThrow({ where: { userId: alice.id } });
    expect(stored).toMatchObject({ email: alice.email, tokenHash: hashToken(token) });

    expect(await verifyEmailToken(token)).toEqual({ status: 'verified' });
    expect((await agent.get('/account/me')).body.user.emailVerified).toBe(true);
  });

  it('replaces the old link once the cooldown is over: only the newest works', async () => {
    const alice = await createUser('Alice');
    const oldToken = await createVerificationLink(alice, { createdAt: new Date(Date.now() - RESEND_COOLDOWN_MS - 1000) });
    const agent = await loginAs(alice);

    const res = await agent.post(route).send();

    expect(res.status).toBe(204);
    expect(outbox.sent).toHaveLength(1);
    expect(await prisma.emailVerificationToken.count()).toBe(1);
    expect(await verifyEmailToken(oldToken)).toEqual({ status: 'invalid' });
    expect(await verifyEmailToken(tokenFromMail(outbox.sent[0]))).toEqual({ status: 'verified' });
  });

  it('returns 409 for a verified address, and sends nothing and stores nothing', async () => {
    const alice = await createUser('Alice');
    await prisma.user.update({ where: { id: alice.id }, data: { emailVerifiedAt: new Date() } });
    const agent = await loginAs(alice);

    const res = await agent.post(route).send();

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'Email is already verified' });
    expect(outbox.sent).toEqual([]);
    expect(await prisma.emailVerificationToken.count()).toBe(0);
  });

  it('returns 429 while the stored link is younger than a minute, and the link keeps working', async () => {
    const alice = await createUser('Alice');
    const token = await createVerificationLink(alice, { createdAt: new Date(Date.now() - 5_000) });
    const agent = await loginAs(alice);

    const res = await agent.post(route).send();

    expect(res.status).toBe(429);
    expect(res.body).toEqual({ error: 'Please wait a minute before asking for another email' });
    expect(outbox.sent).toEqual([]);
    expect(await verifyEmailToken(token)).toEqual({ status: 'verified' });
  });

  it('counts the cooldown from the link that signup mailed', async () => {
    await request(app)
      .post('/account/signup')
      .send({ name: 'alice', email: 'alice@example.com', tel: '+14155552671', password: 'Str0ng!Pass' });
    const alice = await prisma.user.findUniqueOrThrow({ where: { email: 'alice@example.com' } });
    const agent = await loginAs(alice);

    const res = await agent.post(route).send();

    expect(res.status).toBe(429);
    expect(outbox.sent).toHaveLength(1); // signup's mail, and nothing from this request
  });

  it('only ever writes the requester\'s own link', async () => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');
    const bobsToken = await createVerificationLink(bob, { createdAt: new Date(Date.now() - 2 * RESEND_COOLDOWN_MS) });
    const agent = await loginAs(alice);

    await agent.post(route).send();

    expect(outbox.sent.map((mail) => mail.to)).toEqual([alice.email]);
    expect((await prisma.emailVerificationToken.findUniqueOrThrow({ where: { userId: bob.id } })).tokenHash).toBe(
      hashToken(bobsToken)
    );
  });

  it('still answers 204 when the mail cannot be sent, and does not wait for it', async () => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const send = vi.spyOn(outbox, 'send');

    send.mockRejectedValueOnce(new Error('provider is down'));
    const failed = await (await loginAs(alice)).post(route).send();
    // A mail that never finishes: a request that waited for it would never answer.
    send.mockReturnValueOnce(new Promise<void>(() => {}));
    const hanging = await (await loginAs(bob)).post(route).send();

    expect(failed.status).toBe(204);
    expect(hanging.status).toBe(204);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('answers 429 after 5 requests in the window, counted per user', async () => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');
    await prisma.user.update({ where: { id: alice.id }, data: { emailVerifiedAt: new Date() } });
    const aliceAgent = await loginAs(alice);
    const bobAgent = await loginAs(bob);

    for (let i = 0; i < 5; i++) {
      const res = await aliceAgent.post(route).send();
      expect(res.status, `request ${i + 1}`).toBe(409);
    }
    const blocked = await aliceAgent.post(route).send();
    const otherUser = await bobAgent.post(route).send();

    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({ error: 'Too many verification emails requested, try again later' });
    expect(otherUser.status).toBe(204);
  });
});
