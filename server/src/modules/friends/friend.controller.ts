import type { Response, NextFunction } from 'express';
import type { ApiErrorBody, FriendRequestConflictBody } from '../../contract/errors';
import type {
  AcceptedFriendResponse, FriendListResponse, FriendRequestListResponse, FriendRequestResponse, SearchUserResponse
} from '../../contract/responses';
import type { AuthenticatedRequest } from '../../middlewares/UserSessionAuth';
import { toFriendRequest } from './friend.serializer';
import {
  validateTelParam,
  validateSendFriendRequestBody,
  validateGetFriendRequestsQuery,
  validateRequestIdParam,
  validateUserIdParam,
} from './friend.validator';
import {
  findUserByTel,
  createFriendRequest,
  listFriendRequests,
  acceptPendingFriendRequest,
  removePendingFriendRequest,
  listFriends,
  removeFriend,
} from './friend.service';

export async function searchUserByTel(req: AuthenticatedRequest, res: Response<SearchUserResponse | ApiErrorBody>, next: NextFunction) {
  const validation = validateTelParam(req.params.tel);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.message });
  }

  try {
    const user = await findUserByTel(req.user.id, validation.data.tel);

    return res.status(200).json({ user });
  } catch (err) {
    next(err);
  }
}

export async function sendFriendRequest(req: AuthenticatedRequest, res: Response<FriendRequestResponse | FriendRequestConflictBody | ApiErrorBody>, next: NextFunction) {
  const requesterId = req.user.id;

  const validation = validateSendFriendRequestBody(req.body, requesterId);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.message });
  }

  try {
    const result = await createFriendRequest(requesterId, validation.data.receiverId);

    switch (result.status) {
      case 'created':
        return res.status(201).json({ request: toFriendRequest(result.request) });
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

export async function getFriendRequests(req: AuthenticatedRequest, res: Response<FriendRequestListResponse | ApiErrorBody>, next: NextFunction) {
  const validation = validateGetFriendRequestsQuery(req.query);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.message });
  }

  try {
    const requests = await listFriendRequests(req.user.id, validation.data.direction);

    return res.status(200).json({ requests: requests.map(toFriendRequest) });
  } catch (err) {
    next(err);
  }
}

export async function acceptFriendRequest(req: AuthenticatedRequest, res: Response<AcceptedFriendResponse | ApiErrorBody>, next: NextFunction) {
  const validation = validateRequestIdParam(req.params.id);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.message });
  }

  try {
    const result = await acceptPendingFriendRequest(req.user.id, validation.data.requestId);

    switch (result.status) {
      case 'accepted':
        return res.status(201).json({ friend: result.friend });
      case 'not_found':
        return res.status(404).json({ error: 'Friend request not found' });
    }
  } catch (err) {
    next(err);
  }
}

// `:id` is a *request* ID, not a user's.
export async function deleteFriendRequest(req: AuthenticatedRequest, res: Response<ApiErrorBody>, next: NextFunction) {
  const validation = validateRequestIdParam(req.params.id);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.message });
  }

  try {
    const result = await removePendingFriendRequest(req.user.id, validation.data.requestId);

    switch (result.status) {
      case 'deleted':
        return res.status(204).end();
      case 'not_found':
        return res.status(404).json({ error: 'Friend request not found' });
    }
  } catch (err) {
    next(err);
  }
}

export async function getFriends(req: AuthenticatedRequest, res: Response<FriendListResponse>, next: NextFunction) {
  try {
    const friends = await listFriends(req.user.id);

    return res.status(200).json({ friends });
  } catch (err) {
    next(err);
  }
}

// `:id` is a *user* ID, not a request's.
export async function unfriend(req: AuthenticatedRequest, res: Response<ApiErrorBody>, next: NextFunction) {
  const validation = validateUserIdParam(req.params.id);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.message });
  }

  try {
    const result = await removeFriend(req.user.id, validation.data.userId);

    switch (result.status) {
      case 'removed':
        return res.status(204).end();
      case 'not_friends':
        return res.status(404).json({ error: 'You are not friends with this user' });
    }
  } catch (err) {
    next(err);
  }
}
