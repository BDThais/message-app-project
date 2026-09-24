import request from 'supertest';
import app from '../../src/app';
import config from '../../src/config/config';
import { prisma } from '../../src/lib/prisma';

let userCounter = 0;

/**
 * Creates a user with a unique email and phone number (only the name is
 * chosen by the test). The password hash is a placeholder: nothing here logs
 * in through /account/login, so no test pays for hashing a password.
 */
export async function createUser(name: string) {
  const n = ++userCounter;

  return prisma.user.create({
    data: {
      name,
      email: `${name.toLowerCase()}${n}@example.com`,
      tel: `+1415555${String(n).padStart(4, '0')}`,
      passwordHash: 'not-a-real-hash',
    },
  });
}

/**
 * Returns a supertest agent that is already signed in as `user`.
 *
 * It writes the session row and sends its cookie directly instead of calling
 * POST /account/login, so chat-room tests don't depend on the login route
 * (that is tested in test/account/) and don't hit its rate limiter.
 */
export async function loginAs(user: { id: number }) {
  const session = await prisma.session.create({
    data: { userId: user.id, expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
  });

  return request.agent(app).set('Cookie', `${config.SESSION_COOKIE}=${session.id}`);
}

export type TestAgent = Awaited<ReturnType<typeof loginAs>>;
