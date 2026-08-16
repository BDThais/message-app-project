import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../src/app';

import { validateLogin } from '../src/controllers/LoginValidator';
import { createSession, getSessionUser, clearSessionCookie } from '../src/lib/session';
import { prisma } from '../src/lib/prisma';
import config from '../src/config/config';

const loginRoute = '/account/login';
const meRoute = '/account/me';
const logoutRoute = '/account/logout';

// login/me/logout are plain (req, res) handlers, so we don't need the real
// app.ts to exercise them through supertest - mounting them on a bare Express
// app is enough, as long as we replicate the middleware they depend on
// (json body parsing, cookie-parser for req.cookies).

// Everything these controllers talk to gets mocked: LoginValidator and the
// session helpers are collaborators with their own tests, and prisma is a
// real database client we don't want to hit here.
vi.mock('../src/controllers/LoginValidator', () => ({
  validateLogin: vi.fn(),
}));

vi.mock('../src/lib/session', () => ({
  createSession: vi.fn(),
  getSessionUser: vi.fn(),
  clearSessionCookie: vi.fn(),
}));

vi.mock('../src/lib/prisma', () => ({
  prisma: {
    session: {
      deleteMany: vi.fn(),
    },
  },
}));

// Mocked (rather than imported for real) so the suite doesn't depend on
// whatever env vars the real config.ts needs at load time.
vi.mock('../src/config/config', () => ({
  default: {
    SESSION_COOKIE: 'sessionId',
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe(`POST ${loginRoute}`, () => {
  const validCredentials = { email: 'alice@example.com', password: 'correct-password' };
  const dbUser = {
    id: 1,
    name: 'Alice',
    email: 'alice@example.com',
    tel: '5551234567',
    passwordHash: 'should-never-reach-the-response',
  };

  it.each([
    { desc: 'empty body', body: {} },
    { desc: 'missing password', body: { email: 'alice@example.com' } },
    { desc: 'non-string email', body: { email: 123, password: 'secret' } },
  ])('returns 400 for $desc', async ({ body }) => {
    const res = await request(app).post(loginRoute).send(body);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Email and password are required' });
    expect(vi.mocked(validateLogin)).not.toHaveBeenCalled();
  });

  it('returns 401 when the credentials are invalid', async () => {
    vi.mocked(validateLogin).mockResolvedValue(null);

    const res = await request(app).post(loginRoute).send(validCredentials);

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Invalid email or password' });
    expect(vi.mocked(createSession)).not.toHaveBeenCalled();
  });

  it('returns 200 with the user and starts a session on valid credentials', async () => {
    vi.mocked(validateLogin).mockResolvedValue(dbUser);
    vi.mocked(createSession).mockResolvedValue(undefined);

    const res = await request(app).post(loginRoute).send(validCredentials);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      user: { id: dbUser.id, name: dbUser.name, email: dbUser.email, tel: dbUser.tel },
    });
    expect(res.body.user.passwordHash).toBeUndefined();
    expect(vi.mocked(validateLogin)).toHaveBeenCalledWith(
      validCredentials.email,
      validCredentials.password
    );
    expect(vi.mocked(createSession)).toHaveBeenCalledWith(expect.anything(), dbUser.id);
  });

  it('returns 500 when something unexpected throws', async () => {
    vi.mocked(validateLogin).mockRejectedValue(new Error('db is down'));

    const res = await request(app).post(loginRoute).send(validCredentials);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Internal server error' });
  });
});

describe(`GET ${meRoute}`, () => {
  it('returns the user when the session is valid', async () => {
    const sessionUser = { id: 1, name: 'Alice', email: 'alice@example.com', tel: '5551234567' };
    vi.mocked(getSessionUser).mockResolvedValue(sessionUser);

    const res = await request(app).get(meRoute);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ user: sessionUser });
  });

  it('returns { user: null } when there is no valid session', async () => {
    vi.mocked(getSessionUser).mockResolvedValue(null);

    const res = await request(app).get(meRoute);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ user: null });
  });

  it('returns 500 when something unexpected throws', async () => {
    vi.mocked(getSessionUser).mockRejectedValue(new Error('db is down'));

    const res = await request(app).get(meRoute);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Internal server error' });
  });
});

describe(`POST ${logoutRoute}`, () => {
  it('deletes the session and clears the cookie when a session cookie is present', async () => {
    vi.mocked(prisma.session.deleteMany).mockResolvedValue({ count: 1 });

    const res = await request(app)
      .post(logoutRoute)
      .set('Cookie', [`${config.SESSION_COOKIE}=abc123`]);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ user: null });
    expect(vi.mocked(prisma.session.deleteMany)).toHaveBeenCalledWith({ where: { id: 'abc123' } });
    expect(vi.mocked(clearSessionCookie)).toHaveBeenCalled();
  });

  it('still clears the cookie and succeeds when there is no session cookie', async () => {
    const res = await request(app).post(logoutRoute);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ user: null });
    expect(vi.mocked(prisma.session.deleteMany)).not.toHaveBeenCalled();
    expect(vi.mocked(clearSessionCookie)).toHaveBeenCalled();
  });

  it('returns 500 when something unexpected throws', async () => {
    vi.mocked(prisma.session.deleteMany).mockRejectedValue(new Error('db is down'));

    const res = await request(app)
      .post(logoutRoute)
      .set('Cookie', [`${config.SESSION_COOKIE}=abc123`]);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Internal server error' });
  });
});
