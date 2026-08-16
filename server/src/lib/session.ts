import type { Request, Response } from 'express';
import { prisma } from './prisma';
import config from '../config/config';

/**
 * Creates a new session for the user and sets it as a cookie on the response.
 * Deletes any expired session already on file for this account first, per spec.
 * Used by POST /account/login, after the email/password check passes.
 */
export async function createSession(res: Response, userId: number): Promise<void> {
  const expiresAt = new Date(Date.now() + config.SESSION_TTL_MS);

  await prisma.session.deleteMany({
    where: { userId, expiresAt: { lt: new Date() } },
  });

  const session = await prisma.session.create({
    data: { userId, expiresAt },
  });

  res.cookie(config.SESSION_COOKIE, session.id, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax', // switch to 'none' + secure if frontend/backend end up on different domains in prod
    expires: expiresAt,
  });
}

/**
 * Reads the session cookie off the request and resolves it to a user.
 * Returns null if there's no cookie, no matching session, or the session has expired.
 * Used by GET /account/me.
 */
export async function getSessionUser(req: Request, res: Response) {
  const sessionId = req.cookies?.[config.SESSION_COOKIE];
  if (!sessionId) return null;

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: {
      user: {
        select: { id: true, name: true, email: true, tel: true }, // no passwordHash
      },
    },
  });

  if (!session) return null;

  if (session.expiresAt < new Date()) {
    await prisma.session.delete({ where: { id: sessionId } });
    clearSessionCookie(res); // no point making the browser hold on to a dead cookie
    return null;
  }

  return session.user;
}

/**
 * Tells the browser to drop the session cookie.
 * Used by POST /account/logout. The logout route still needs to delete the
 * session row itself (a one-liner with prisma.session.delete).
 */
export function clearSessionCookie(res: Response): void {
  res.clearCookie(config.SESSION_COOKIE, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
  });
}
