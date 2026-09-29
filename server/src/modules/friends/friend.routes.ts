import Router from 'express';
import { requireUserAuth } from '../../middlewares/UserSessionAuth';
import { friendSearchLimiter } from './friendRateLimit.middleware';
import { searchUserByTel } from './friend.controller';

const friendRouter = Router();

friendRouter.use(requireUserAuth);

// The limiter is per user, so it has to come after requireUserAuth (which sets req.user).
friendRouter.get('/search/:tel', friendSearchLimiter, searchUserByTel);

export default friendRouter;
