import { describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../src/app';
import { prisma } from '../src/lib/prisma';
import { verifyPassword } from '../src/lib/passwordHash';

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
});
