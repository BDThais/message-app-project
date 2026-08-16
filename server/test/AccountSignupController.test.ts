import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { prisma } from '../src/lib/prisma';
import { hashPassword } from '../src/lib/passwordHash';
import app from '../src/app';

// A tiny app with just this route mounted — no need to pull in the full
// production app (sessions, sockets, etc.) just to test one controller.

const signUpRoute = '/account/signup';

// Replace the real Prisma client and password hasher with test doubles so
// these tests don't touch a real database or run real hashing.
vi.mock('../src/lib/prisma', () => ({
  prisma: {
    user: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
  },
}));

vi.mock('../src/lib/passwordHash', () => ({
  hashPassword: vi.fn().mockResolvedValue('hashed-password'),
}));

const validBody = {
  name: 'johndoe',
  email: 'john@example.com',
  tel: '+14155552671',
  password: 'Str0ng!Pass',
};

describe(`POST ${signUpRoute}`, () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates an account and returns 201 for valid input', async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.user.create).mockResolvedValue({ id: 1, ...validBody } as any);

    const res = await request(app).post(signUpRoute).send(validBody);

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ message: 'Account created successfully' });
    expect(hashPassword).toHaveBeenCalledWith(validBody.password);
    expect(prisma.user.create).toHaveBeenCalledWith({
      data: {
        name: validBody.name,
        email: validBody.email,
        tel: validBody.tel,
        passwordHash: 'hashed-password',
      },
    });
  });

  it('returns 400 when a field is missing', async () => {
    const { password: _password, ...rest } = validBody;
    const res = await request(app).post(signUpRoute).send(rest);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('All fields are required');
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
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
    vi.mocked(prisma.user.findFirst).mockResolvedValue({
      email: validBody.email,
      tel: 'some-other-number',
    } as any);

    const res = await request(app).post(signUpRoute).send(validBody);

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Email already exists');
  });

  it('returns 409 on a Prisma unique-constraint race condition', async () => {
    // Simulates two signups landing at once: the findFirst check passes,
    // but the DB itself rejects the insert on the unique index.
    vi.mocked(prisma.user.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.user.create).mockRejectedValue({
      code: 'P2002',
      meta: { target: ['tel'] },
    });

    const res = await request(app).post(signUpRoute).send(validBody);

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Phone number already exists');
  });

  it('returns 500 on an unexpected error', async () => {
    vi.mocked(prisma.user.findFirst).mockRejectedValue(new Error('DB is down'));

    const res = await request(app).post(signUpRoute).send(validBody);

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Internal server error');
  });
});
