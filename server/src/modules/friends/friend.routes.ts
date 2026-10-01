import Router from 'express';
import { requireUserAuth } from '../../middlewares/UserSessionAuth';
import { friendSearchLimiter, friendRequestLimiter } from './friendRateLimit.middleware';
import {
  searchUserByTel,
  sendFriendRequest,
  getFriendRequests,
  acceptFriendRequest,
} from './friend.controller';

const friendRouter = Router();

friendRouter.use(requireUserAuth);

// The limiter is per user, so it has to come after requireUserAuth (which sets req.user).
friendRouter.get('/search/:tel', friendSearchLimiter, searchUserByTel);
friendRouter.post('/requests', friendRequestLimiter, sendFriendRequest);
friendRouter.get('/requests', getFriendRequests);
friendRouter.post('/requests/:id/accept', acceptFriendRequest);

export default friendRouter;
