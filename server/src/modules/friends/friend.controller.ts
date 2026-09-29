import type { Request, Response, NextFunction } from 'express';
import { validateTelParam } from './friend.validator';
import { findUserByTel } from './friend.service';

// Route chain (see friend.routes.ts): requireUserAuth -> friendSearchLimiter,
// so by the time this runs the requester is signed in and within their search
// quota. Finding nobody is a normal outcome, not an error: 200 with user: null.
export async function searchUserByTel(req: Request, res: Response, next: NextFunction) {
  const validation = validateTelParam(req.params.tel);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.message });
  }

  try {
    const user = await findUserByTel(req.user!.id, validation.data.tel);

    return res.status(200).json({ user });
  } catch (err) {
    next(err);
  }
}
