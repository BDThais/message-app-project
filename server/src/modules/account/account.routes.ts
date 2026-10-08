import Router from 'express';
import { requireUserAuth } from '../../middlewares/UserSessionAuth';
import {signup, login, logout, me, updateMe, updatePassword, deleteMe, verifyEmail, resendEmailVerification} from './account.controller';
import { loginLimiter, passwordCheckLimiter, emailVerifyLimiter, emailVerificationRequestLimiter } from './accountRateLimit.middleware';

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
// No session: the token in the body is the credential (the link is opened from a mail, maybe on another device).
accountRouter.post('/email/verify', emailVerifyLimiter, verifyEmail);
// Per user again, so after requireUserAuth.
accountRouter.post('/email/verification', requireUserAuth, emailVerificationRequestLimiter, resendEmailVerification);

export default accountRouter;
