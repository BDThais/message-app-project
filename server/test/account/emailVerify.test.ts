import { describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { createVerificationLink, tokenFromMail } from '../helpers/emailVerification';
import { outbox } from '../helpers/mailer';
import { createUser, loginAs } from '../helpers/users';

// emailVerifyLimiter allows 10 requests per IP in 15 minutes, and every test in this file shares
// that one budget (the limiter lives as long as the file does), so keep the requests to the route
// few: the rules that need many are tested on the service (emailVerification.service.test.ts) and
// the bad bodies in the validator's unit test. The limiter itself is in emailVerifyLimiter.test.ts.
const route = '/account/email/verify';
const invalidLink = { error: 'This verification link is invalid or has expired' };

describe(`POST ${route}`, () => {
  it('verifies the account whose link was mailed at signup, without a session, and only that account', async () => {
    const signup = await request(app)
      .post('/account/signup')
      .send({ name: 'alice', email: 'alice@example.com', tel: '+14155552671', password: 'Str0ng!Pass' });
    expect(signup.status).toBe(201);
    const token = tokenFromMail(outbox.sent[0]);
    const bob = await createUser('Bob');
    await createVerificationLink(bob);

    const res = await request(app).post(route).send({ token });

    expect(res.status).toBe(204);
    expect(res.body).toEqual({});
    const alice = await prisma.user.findUniqueOrThrow({ where: { email: 'alice@example.com' } });
    expect(alice.emailVerifiedAt).toBeInstanceOf(Date);
    expect(Math.abs(Date.now() - alice.emailVerifiedAt!.getTime())).toBeLessThan(60_000);
    expect(await prisma.emailVerificationToken.count({ where: { userId: alice.id } })).toBe(0);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: bob.id } })).emailVerifiedAt).toBeNull();
    expect(await prisma.emailVerificationToken.count({ where: { userId: bob.id } })).toBe(1);

    // The frontend learns about it from the user shape.
    const me = await (await loginAs(alice)).get('/account/me');
    expect(me.body.user.emailVerified).toBe(true);
  });

  it('works once: the same link a second time is a 400, and the first timestamp stays', async () => {
    const alice = await createUser('Alice');
    const token = await createVerificationLink(alice);

    const first = await request(app).post(route).send({ token });
    const verifiedAt = (await prisma.user.findUniqueOrThrow({ where: { id: alice.id } })).emailVerifiedAt;
    const second = await request(app).post(route).send({ token });

    expect(first.status).toBe(204);
    expect(second.status).toBe(400);
    expect(second.body).toEqual(invalidLink);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: alice.id } })).emailVerifiedAt).toEqual(verifiedAt);
  });

  it('answers 400 for a body without a token (the full table is in the validator test)', async () => {
    const res = await request(app).post(route).send({});

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Token is required' });
  });

  it('answers the same 400 for an unknown token, and changes nothing', async () => {
    const alice = await createUser('Alice');
    await createVerificationLink(alice);

    const res = await request(app).post(route).send({ token: 'not-a-token-anybody-was-sent' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual(invalidLink);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: alice.id } })).emailVerifiedAt).toBeNull();
    expect(await prisma.emailVerificationToken.count()).toBe(1);
  });

  it('answers the same 400 for an expired link, which verifies nothing', async () => {
    const alice = await createUser('Alice');
    const token = await createVerificationLink(alice, { expiresAt: new Date(Date.now() - 1000) });

    const res = await request(app).post(route).send({ token });

    expect(res.status).toBe(400);
    expect(res.body).toEqual(invalidLink);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: alice.id } })).emailVerifiedAt).toBeNull();
  });

  it('answers the same 400 for a link issued for an address the account no longer has', async () => {
    const alice = await createUser('Alice');
    const token = await createVerificationLink(alice);
    await prisma.user.update({ where: { id: alice.id }, data: { email: 'alice.new@example.com' } });

    const res = await request(app).post(route).send({ token });

    expect(res.status).toBe(400);
    expect(res.body).toEqual(invalidLink);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: alice.id } })).emailVerifiedAt).toBeNull();
  });

  it('does not take a session or a cookie into account', async () => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');
    const token = await createVerificationLink(alice);
    const bobAgent = await loginAs(bob);

    const res = await bobAgent.post(route).send({ token });

    // Whoever holds the link verifies the account it was issued for, whoever they are signed in as.
    expect(res.status).toBe(204);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: alice.id } })).emailVerifiedAt).not.toBeNull();
    expect((await prisma.user.findUniqueOrThrow({ where: { id: bob.id } })).emailVerifiedAt).toBeNull();
  });
});
