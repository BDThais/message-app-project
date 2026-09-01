import type { Request, Response, NextFunction } from 'express';
import { getSessionUser } from '../lib/session';

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

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const user = await getSessionUser(req, res);

    if (!user) {
      return res.status(401).json({ error: 'Unauthorized Access' });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error('Error in requireAuth middleware:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
