import { describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../src/app';
import config from '../src/config/config';
import { hashPassword } from '../src/lib/passwordHash';
import { prisma } from '../src/lib/prisma';

const loginRoute = '/account/login';
const meRoute = '/account/me';
const logoutRoute = '/account/logout';

const userData = {
  name: 'Alice',
  email: 'alice@example.com',
  tel: '+14155552671',
  password: 'Str0ng!Pass',
};

async function createUser() {
  return prisma.user.create({
    data: {
      name: userData.name,
      email: userData.email,
      tel: userData.tel,
      passwordHash: await hashPassword(userData.password),
    },
  });
}

describe(`POST ${loginRoute}`, () => {
  it.each([
    { desc: 'empty body', body: {} },
    { desc: 'missing password', body: { email: userData.email } },
    { desc: 'non-string email', body: { email: 123, password: userData.password } },
  ])('returns 400 for $desc', async ({ body }) => {
    const res = await request(app).post(loginRoute).send(body);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Email and password are required' });
  });

  it('returns 401 when the credentials are invalid', async () => {
    await createUser();

    const res = await request(app)
      .post(loginRoute)
      .send({ email: userData.email, password: 'Wrong!Pass1' });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Invalid email or password' });
    expect(await prisma.session.count()).toBe(0);
  });

  it('returns 200 and persists a session for valid credentials', async () => {
    const user = await createUser();

    const res = await request(app)
      .post(loginRoute)
      .send({ email: userData.email, password: userData.password });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      user: { id: user.id, name: user.name, email: user.email, tel: user.tel },
    });
    expect(res.body.user.passwordHash).toBeUndefined();
    expect(res.headers['set-cookie']).toEqual(
      expect.arrayContaining([expect.stringContaining(`${config.SESSION_COOKIE}=`)])
    );
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(1);
  });
});

describe(`GET ${meRoute}`, () => {
  it('returns the user when the session is valid', async () => {
    await createUser();
    const agent = request.agent(app);

    const login = await agent
      .post(loginRoute)
      .send({ email: userData.email, password: userData.password });
    const res = await agent.get(meRoute);

    expect(login.status).toBe(200);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      user: { name: userData.name, email: userData.email, tel: userData.tel, id: expect.any(Number) },
    });
  });

  it('returns { user: null } when there is no valid session', async () => {
    const res = await request(app).get(meRoute);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ user: null });
  });

  it('returns { user: null } and removes an expired session', async () => {
    const user = await createUser();
    const session = await prisma.session.create({
      data: { userId: user.id, expiresAt: new Date(Date.now() - 1000) },
    });

    const res = await request(app)
      .get(meRoute)
      .set('Cookie', `${config.SESSION_COOKIE}=${session.id}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ user: null });
    expect(await prisma.session.findUnique({ where: { id: session.id } })).toBeNull();
  });
});

describe(`POST ${logoutRoute}`, () => {
  it('deletes the session and clears the cookie', async () => {
    await createUser();
    const agent = request.agent(app);

    await agent
      .post(loginRoute)
      .send({ email: userData.email, password: userData.password });
    expect(await prisma.session.count()).toBe(1);

    const res = await agent.post(logoutRoute);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ user: null });
    expect(await prisma.session.count()).toBe(0);
    expect((await agent.get(meRoute)).body).toEqual({ user: null });
  });

  it('succeeds when there is no session cookie', async () => {
    const res = await request(app).post(logoutRoute);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ user: null });
  });
});
