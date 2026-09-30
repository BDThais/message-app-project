import type { Request, Response, NextFunction } from 'express';
import {
  validateTelParam,
  validateSendFriendRequestBody,
  validateGetFriendRequestsQuery,
} from './friend.validator';
import { findUserByTel, createFriendRequest, listFriendRequests } from './friend.service';

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

// Route chain (see friend.routes.ts): requireUserAuth -> friendRequestLimiter.
// The service reports the expected refusals as a `status`; anything it throws
// is unexpected and goes to the shared error handler.
export async function sendFriendRequest(req: Request, res: Response, next: NextFunction) {
  const requesterId = req.user!.id;

  const validation = validateSendFriendRequestBody(req.body, requesterId);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.message });
  }

  try {
    const result = await createFriendRequest(requesterId, validation.data.receiverId);

    switch (result.status) {
      case 'created':
        return res.status(201).json({ request: result.request });
      case 'receiver_not_found':
        return res.status(400).json({ error: 'receiver_id does not refer to an existing user' });
      case 'already_friends':
        return res.status(409).json({ error: 'You are already friends with this user' });
      case 'already_sent':
        return res.status(409).json({ error: 'You have already sent this user a friend request' });
      case 'already_received':
        return res.status(409).json({
          error: 'This user has already sent you a friend request',
          requestId: result.requestId,
        });
    }
  } catch (err) {
    next(err);
  }
}

// Route chain (see friend.routes.ts): requireUserAuth only. Listing what
// already concerns the requester tells them nothing about anyone else, so it
// has no limiter. An empty list is a normal outcome: 200 with requests: [].
export async function getFriendRequests(req: Request, res: Response, next: NextFunction) {
  const validation = validateGetFriendRequestsQuery(req.query);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.message });
  }

  try {
    const requests = await listFriendRequests(req.user!.id, validation.data.direction);

    return res.status(200).json({ requests });
  } catch (err) {
    next(err);
  }
}
