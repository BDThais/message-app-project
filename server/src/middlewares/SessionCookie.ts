import type { Request, Response } from 'express';
import config from '../config/config';
import { findSessionUser } from '../modules/account/session.service';

// HTTP side of sessions: everything that touches the session cookie. The
// database side lives in modules/account/session.service.ts.

// A function (not a constant) so NODE_ENV is read when the cookie is sent, as before.
const cookieBaseOptions = () =>
  ({
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax', // switch to 'none' + secure if frontend/backend end up on different domains in prod
  }) as const;

/**
 * Sends the session id to the browser as a cookie.
 * Used by POST /account/login, with the session returned by createSession.
 */
export function setSessionCookie(res: Response, session: { id: string; expiresAt: Date }): void {
  res.cookie(config.SESSION_COOKIE, session.id, {
    ...cookieBaseOptions(),
    expires: session.expiresAt,
  });
}

/**
 * Tells the browser to drop the session cookie.
 * Used by POST /account/logout. The logout route still needs to delete the
 * session row itself (deleteSession in session.service.ts).
 */
export function clearSessionCookie(res: Response): void {
  res.clearCookie(config.SESSION_COOKIE, cookieBaseOptions());
}

/**
 * Reads the session cookie off the request and resolves it to a user.
 * Returns null if there's no cookie, no matching session, or the session has expired.
 * Used by GET /account/me and by the requireUserAuth middleware.
 */
export async function getSessionUser(req: Request, res: Response) {
  const sessionId = req.cookies?.[config.SESSION_COOKIE];
  if (!sessionId) return null;

  const result = await findSessionUser(sessionId);

  if (result.status === 'expired') {
    clearSessionCookie(res); // no point making the browser hold on to a dead cookie
  }

  return result.status === 'valid' ? result.user : null;
}
