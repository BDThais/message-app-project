import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { getSessionUser } from './SessionCookie';

// Derived from getSessionUser's own return type rather than importing Prisma's User
// type directly, so this stays correct even if getSessionUser returns a trimmed-down
// shape (e.g. without passwordHash) instead of the raw model.
type SessionUser = NonNullable<Awaited<ReturnType<typeof getSessionUser>>>;

declare global {
  namespace Express {
    interface Request {
      user?: SessionUser;
    }
  }
}

/** A request that has been through requireUserAuth: `user` is there, not optional. */
export type AuthenticatedRequest = Request & { user: SessionUser };

export function hasUser(req: Request): req is AuthenticatedRequest {
  return req.user !== undefined;
}

/**
 * Mounts a handler that needs `req.user` behind requireUserAuth without a `!` in the handler: it
 * is written against an AuthenticatedRequest, and this checks it is one. A route that was mounted
 * without requireUserAuth in front gets an error instead of a TypeError on `req.user.id`.
 */
export function withUser<ResBody>(
  handler: (req: AuthenticatedRequest, res: Response<ResBody>, next: NextFunction) => unknown,
): RequestHandler {
  return async (req, res, next) => {
    if (!hasUser(req)) {
      return next(new Error('A route that needs req.user was mounted without requireUserAuth before it'));
    }
    await handler(req, res, next);
  };
}

/**
 * The key of a per-user rate limiter. Without requireUserAuth before it there is no user to count:
 * an error, not one counter shared by everybody.
 */
export function userKey(req: Request): string {
  if (!hasUser(req)) {
    throw new Error('A per-user rate limiter was mounted without requireUserAuth before it');
  }
  return String(req.user.id);
}

export async function requireUserAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const user = await getSessionUser(req, res);

    if (!user) {
      return res.status(401).json({ error: 'Unauthorized Access' });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error('Error in requireUserAuth middleware:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
