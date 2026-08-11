import type { Request, Response } from 'express';
import { prisma } from './prisma';

const SESSION_COOKIE = 'session_id';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

/**
 * Creates a new session for the user and sets it as a cookie on the response.
 * Deletes any expired session already on file for this account first, per spec.
 * Used by POST /account/login, after the email/password check passes.
 */
export async function createSession(res: Response, userId: number): Promise<void> {
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await prisma.session.deleteMany({
    where: { userId, expiresAt: { lt: new Date() } },
  });

  const session = await prisma.session.create({
    data: { userId, expiresAt },
  });

  res.cookie(SESSION_COOKIE, session.id, {
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
  const sessionId = req.cookies?.[SESSION_COOKIE];
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
 * session row itself (a one-liner with prisma.session.delete) — kept out of
 * this function since you asked to scope this to just the 3 auth functions.
 */
export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
  });
}
