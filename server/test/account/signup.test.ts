import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import app from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { verifyPassword } from '../../src/lib/passwordHash';
import * as accountService from '../../src/modules/account/account.service';

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
