import Router from 'express';
import { requireUserAuth, withUser } from '../../middlewares/UserSessionAuth';
import { friendSearchLimiter, friendRequestLimiter } from './friendRateLimit.middleware';
import {
  searchUserByTel,
  sendFriendRequest,
  getFriendRequests,
  acceptFriendRequest,
  deleteFriendRequest,
  getFriends,
  unfriend,
} from './friend.controller';

const friendRouter = Router();

friendRouter.use(requireUserAuth);

friendRouter.get('/', withUser(getFriends));
// The limiter is per user, so it has to come after requireUserAuth (which sets req.user).
friendRouter.get('/search/:tel', friendSearchLimiter, withUser(searchUserByTel));
friendRouter.post('/requests', friendRequestLimiter, withUser(sendFriendRequest));
friendRouter.get('/requests', withUser(getFriendRequests));
friendRouter.post('/requests/:id/accept', withUser(acceptFriendRequest));
friendRouter.delete('/requests/:id', withUser(deleteFriendRequest));
friendRouter.delete('/:id', withUser(unfriend));

export default friendRouter;
