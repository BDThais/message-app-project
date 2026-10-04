import Router from 'express';
import { requireUserAuth } from '../../middlewares/UserSessionAuth';
import {signup, login, logout, me, updateMe, updatePassword, deleteMe} from './account.controller';
import { loginLimiter, passwordCheckLimiter } from './accountRateLimit.middleware';

const accountRouter = Router();

accountRouter.post('/signup', signup);
accountRouter.post('/login', loginLimiter, login);
accountRouter.post('/logout', logout);
accountRouter.get('/me', me);
accountRouter.patch('/me', requireUserAuth, updateMe);
// The limiter is per user, so it has to come after requireUserAuth (which sets req.user).
accountRouter.post('/password', requireUserAuth, passwordCheckLimiter, updatePassword);
// Same limiter, same budget: both routes let a session holder guess the current password.
accountRouter.delete('/me', requireUserAuth, passwordCheckLimiter, deleteMe);

export default accountRouter;
