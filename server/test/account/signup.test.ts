import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import app from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import config from '../../src/config/config';
import { verifyPassword } from '../../src/lib/passwordHash';
import { hashToken } from '../../src/lib/randomToken';
import * as accountService from '../../src/modules/account/account.service';
import { createVerificationLink, tokenFromMail } from '../helpers/emailVerification';
import { outbox } from '../helpers/mailer';

const signUpRoute = '/account/signup';

const validBody = {
  name: 'johndoe',
  email: 'john@example.com',
  tel: '+14155552671',
  password: 'Str0ng!Pass',
};

describe(`POST ${signUpRoute}`, () => {
  it('creates an account and persists the hashed password', async () => {
    const res = await request(app).post(signUpRoute).send(validBody);

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ message: 'Account created successfully' });

    const user = await prisma.user.findUnique({ where: { email: validBody.email } });
    expect(user).toMatchObject({
      name: validBody.name,
      email: validBody.email,
      tel: validBody.tel,
    });
    expect(user?.passwordHash).not.toBe(validBody.password);
    expect(await verifyPassword(user!.passwordHash, validBody.password)).toBe(true);
  });

  // isValidPhoneNumber accepts all of these; the stored (and searchable) form is
  // the canonical E.164 number, so they all end up as validBody.tel.
  it.each([
    ['parentheses and dashes', '+1 (415) 555-2671'],
    ['spaces', '+1 415 555 2671'],
    ['an extension', '+14155552671 ext. 123'],
  ])('stores the canonical number when the phone number is typed with %s', async (_label, tel) => {
    const res = await request(app).post(signUpRoute).send({ ...validBody, tel });

    expect(res.status).toBe(201);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: validBody.email } });
    expect(user.tel).toBe(validBody.tel);
  });

  it('returns 400 when a field is missing', async () => {
    const { password: _password, ...rest } = validBody;
    const res = await request(app).post(signUpRoute).send(rest);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('All fields are required');
    expect(await prisma.user.count()).toBe(0);
  });

  it('returns 400 for an invalid email', async () => {
    const res = await request(app)
      .post(signUpRoute)
      .send({ ...validBody, email: 'not-an-email' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid email format');
  });

  it('returns 400 for an invalid phone number', async () => {
    const res = await request(app)
      .post(signUpRoute)
      .send({ ...validBody, tel: '123' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid phone number format');
  });

  it('returns 400 for a weak password', async () => {
    const res = await request(app)
      .post(signUpRoute)
      .send({ ...validBody, password: 'weak' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Password must/);
  });

  it('returns 409 when the email is already taken', async () => {
    await prisma.user.create({
      data: {
        name: 'existing-user',
        email: validBody.email,
        tel: '+14155552672',
        passwordHash: 'existing-hash',
      },
    });

    const res = await request(app).post(signUpRoute).send(validBody);

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Email already exists');
  });

  it('returns 409 when the phone number is already taken', async () => {
    await prisma.user.create({
      data: {
        name: 'existing-user',
        email: 'existing@example.com',
        tel: validBody.tel,
        passwordHash: 'existing-hash',
      },
    });

    const res = await request(app).post(signUpRoute).send(validBody);

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Phone number already exists');
  });

  it('returns 409 when the same phone number is already registered in another spelling', async () => {
    await prisma.user.create({
      data: {
        name: 'existing-user',
        email: 'existing@example.com',
        tel: validBody.tel,
        passwordHash: 'existing-hash',
      },
    });

    const res = await request(app)
      .post(signUpRoute)
      .send({ ...validBody, tel: '+1 (415) 555-2671' });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Phone number already exists');
    expect(await prisma.user.count()).toBe(1);
  });

  // The duplicate check and the insert are two statements, so two signups for
  // the same address can both pass the check and the database refuses the
  // second insert. Pretending the check found nothing is that situation, and
  // the 409 must name the column that really collided.
  describe('when the database refuses the insert after the duplicate check passed', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    // The existing account has validBody's email and phone number; each case
    // changes one of them, so only the other one collides.
    it.each([
      ['email', { tel: '+14155552672' }, 'Email already exists'],
      ['phone number', { email: 'other@example.com' }, 'Phone number already exists'],
    ])('names the %s as the cause', async (_label, changedField, expectedError) => {
      await prisma.user.create({
        data: { name: 'existing-user', email: validBody.email, tel: validBody.tel, passwordHash: 'existing-hash' },
      });
      // This request's check ran before the user above was inserted.
      vi.spyOn(accountService, 'findExistingUser').mockResolvedValueOnce(null);

      const res = await request(app).post(signUpRoute).send({ ...validBody, ...changedField });

      expect(res.status).toBe(409);
      expect(res.body).toEqual({ error: expectedError });
      expect(await prisma.user.count()).toBe(1);
    });
  });
});

describe(`POST ${signUpRoute} (verification email)`, () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('leaves the account unverified and mails exactly one link to its address', async () => {
    const res = await request(app).post(signUpRoute).send(validBody);

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ message: 'Account created successfully' });
    expect(outbox.sent).toHaveLength(1);
    expect(outbox.sent[0].to).toBe(validBody.email);
    expect(outbox.sent[0].text).toContain(`${config.EMAIL_VERIFICATION_URL}#token=`);

    const user = await prisma.user.findUniqueOrThrow({
      where: { email: validBody.email },
      include: { emailVerificationToken: true },
    });
    expect(user.emailVerifiedAt).toBeNull();
    expect(user.emailVerificationToken).toMatchObject({ email: validBody.email });
  });

  it('stores only the hash of the mailed token, valid for the configured time', async () => {
    await request(app).post(signUpRoute).send(validBody);

    const token = tokenFromMail(outbox.sent[0]);
    const stored = await prisma.emailVerificationToken.findFirstOrThrow();
    expect(stored.tokenHash).toBe(hashToken(token));
    expect(stored.tokenHash).not.toContain(token);
    // Both times come from the same `now`, so the lifetime is exactly the configured one.
    expect(stored.expiresAt.getTime() - stored.createdAt.getTime()).toBe(config.EMAIL_VERIFICATION_TTL_MS);
  });

  it('stamps the link with the server clock, whatever time zone the database is in', async () => {
    const before = Date.now();

    await request(app).post(signUpRoute).send(validBody);

    // The cooldown of POST /account/email/verification counts from this time.
    const stored = await prisma.emailVerificationToken.findFirstOrThrow();
    expect(stored.createdAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(stored.createdAt.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it('does not sign the new user in', async () => {
    const res = await request(app).post(signUpRoute).send(validBody);

    expect(res.headers['set-cookie']).toBeUndefined();
    expect(await prisma.session.count()).toBe(0);
  });

  it('mails nothing and stores no link when the signup is refused', async () => {
    const invalid = await request(app).post(signUpRoute).send({ ...validBody, password: 'weak' });
    expect(invalid.status).toBe(400);

    await prisma.user.create({
      data: { name: 'existing-user', email: validBody.email, tel: '+14155552672', passwordHash: 'existing-hash' },
    });
    const duplicate = await request(app).post(signUpRoute).send(validBody);
    expect(duplicate.status).toBe(409);

    expect(outbox.sent).toEqual([]);
    expect(await prisma.emailVerificationToken.count()).toBe(0);
  });

  it('keeps no link for the signup that lost a race for the address', async () => {
    const winner = await prisma.user.create({
      data: { name: 'existing-user', email: validBody.email, tel: validBody.tel, passwordHash: 'existing-hash' },
    });
    await createVerificationLink(winner);
    vi.spyOn(accountService, 'findExistingUser').mockResolvedValueOnce(null);

    const res = await request(app).post(signUpRoute).send(validBody);

    expect(res.status).toBe(409);
    expect(outbox.sent).toEqual([]);
    // Only the winner's link: the loser's insert was refused as a whole, token row included.
    expect(await prisma.emailVerificationToken.count()).toBe(1);
    expect((await prisma.emailVerificationToken.findFirstOrThrow()).userId).toBe(winner.id);
  });

  it('still answers 201 and keeps the account when the mail cannot be sent', async () => {
    vi.spyOn(outbox, 'send').mockRejectedValue(new Error('provider is down'));
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await request(app).post(signUpRoute).send(validBody);

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ message: 'Account created successfully' });
    expect(logged).toHaveBeenCalled();
    // The link exists, so the user can still ask for a fresh mail once they are signed in.
    expect(await prisma.emailVerificationToken.count()).toBe(1);
  });

  it('does not wait for the mail before answering', async () => {
    // A mail that never finishes: a request that waited for it would never answer.
    vi.spyOn(outbox, 'send').mockReturnValue(new Promise<void>(() => {}));

    const res = await request(app).post(signUpRoute).send(validBody);

    expect(res.status).toBe(201);
    expect(outbox.send).toHaveBeenCalledTimes(1);
  });
});
