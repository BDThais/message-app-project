import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import app from '../../src/app';
import config from '../../src/config/config';
import { prisma } from '../../src/lib/prisma';
import { hashToken } from '../../src/lib/randomToken';
import { verifyEmailToken } from '../../src/modules/account/emailVerification.service';
import { resetPasswordWithToken } from '../../src/modules/account/passwordReset.service';
import { tokenFromMail } from '../helpers/emailVerification';
import { outbox } from '../helpers/mailer';
import { createVerifiedUser } from '../helpers/passwordReset';
import { createUser } from '../helpers/users';

// passwordResetRequestIpLimiter allows 10 requests per IP in 15 minutes, and every test in this file
// shares that one budget (the limiter lives as long as the file does), so this file sends 9 requests
// to the route in all: keep it under 10. The rules that need many requests are tested on the service
// (passwordReset.service.test.ts), the bad bodies in the validator's unit test, and the limiters in
// the files named *Limiter.test.ts.
const route = '/api/account/password/reset-request';
const accepted = { message: 'If an account exists for that email, a reset link is on its way' };

afterEach(() => {
  vi.restoreAllMocks();
});

describe(`POST ${route}`, () => {
  it('answers 400 for a body that is not an email (the full table is in the validator test), and sends nothing', async () => {
    const res = await request(app).post(route).send({ email: 'not-an-email' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid email format' });
    expect(outbox.sent).toEqual([]);
  });

  it('answers the same 202 for a known and an unknown address, and mails a working link only to the known one, without a session', async () => {
    const alice = await createVerifiedUser('Alice');

    const known = await request(app).post(route).send({ email: alice.email });
    const unknown = await request(app).post(route).send({ email: 'nobody@example.com' });

    expect(known.status).toBe(202);
    expect(known.body).toEqual(accepted);
    expect(unknown.status).toBe(202);
    expect(unknown.body).toEqual(known.body);
    expect(unknown.headers['content-type']).toBe(known.headers['content-type']);
    expect(outbox.sent).toHaveLength(1);
    expect(outbox.sent[0]).toMatchObject({ to: alice.email, subject: 'Reset your password' });
    expect(outbox.sent[0]!.text).toContain(`${config.PASSWORD_RESET_URL}#token=`);
    const token = tokenFromMail(outbox.sent[0]!);
    expect(await prisma.passwordResetToken.count()).toBe(1);
    expect((await prisma.passwordResetToken.findUniqueOrThrow({ where: { userId: alice.id } })).tokenHash).toBe(hashToken(token));
    expect(await resetPasswordWithToken(token, 'new-hash')).toEqual({ status: 'reset', email: alice.email });
  });

  it('matches the address exactly, like login: another spelling of the case gets nothing, and the same 202', async () => {
    const alice = await createVerifiedUser('Alice');
    await prisma.user.update({ where: { id: alice.id }, data: { email: 'Alice.Smith@example.com' } });

    const res = await request(app).post(route).send({ email: 'alice.smith@example.com' });

    expect(res.status).toBe(202);
    expect(res.body).toEqual(accepted);
    expect(outbox.sent).toEqual([]);
    expect(await prisma.passwordResetToken.count()).toBe(0);
  });

  it('sends an account that never verified its address the verification mail instead, with the same 202', async () => {
    const alice = await createUser('Alice');

    const res = await request(app).post(route).send({ email: alice.email });

    expect(res.status).toBe(202);
    expect(res.body).toEqual(accepted);
    expect(outbox.sent).toHaveLength(1);
    expect(outbox.sent[0]).toMatchObject({ to: alice.email, subject: 'Confirm your email address' });
    expect(await prisma.passwordResetToken.count()).toBe(0);
    // The link in it is the verification link: it verifies the address, after which asking again sends a reset link.
    expect(await verifyEmailToken(tokenFromMail(outbox.sent[0]!))).toEqual({ status: 'verified' });
  });

  it('mails one link for two requests within a minute, answers both the same, and the first link keeps working', async () => {
    const alice = await createVerifiedUser('Alice');

    const first = await request(app).post(route).send({ email: alice.email });
    const second = await request(app).post(route).send({ email: alice.email });

    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    expect(second.body).toEqual(first.body);
    expect(outbox.sent).toHaveLength(1);
    expect(await resetPasswordWithToken(tokenFromMail(outbox.sent[0]!), 'new-hash')).toEqual({ status: 'reset', email: alice.email });
  });

  it('still answers 202 when the mail cannot be sent, and does not wait for it', async () => {
    const alice = await createVerifiedUser('Alice');
    const bob = await createVerifiedUser('Bob');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const send = vi.spyOn(outbox, 'send');

    send.mockRejectedValueOnce(new Error('provider is down'));
    const failed = await request(app).post(route).send({ email: alice.email });
    // A mail that never finishes: a request that waited for it would never answer.
    send.mockReturnValueOnce(new Promise<void>(() => {}));
    const hanging = await request(app).post(route).send({ email: bob.email });

    expect(failed.status).toBe(202);
    expect(hanging.status).toBe(202);
    expect(send).toHaveBeenCalledTimes(2);
  });
});
