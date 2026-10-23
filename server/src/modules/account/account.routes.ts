import Router from 'express';
import { requireUserAuth, withUser } from '../../middlewares/UserSessionAuth';
import {
  signup,
  login,
  logout,
  me,
  updateMe,
  updatePassword,
  deleteMe,
  verifyEmail,
  resendEmailVerification,
  requestPasswordReset,
  resetPassword
} from './account.controller';
import {
  loginLimiter,
  passwordCheckLimiter,
  emailVerifyLimiter,
  emailVerificationRequestLimiter,
  passwordResetRequestIpLimiter,
  passwordResetRequestEmailLimiter,
  passwordResetLimiter,
} from './accountRateLimit.middleware';

const accountRouter = Router();

accountRouter.post('/signup', signup);
accountRouter.post('/login', loginLimiter, login);
accountRouter.post('/logout', logout);
accountRouter.get('/me', me);
accountRouter.patch('/me', requireUserAuth, withUser(updateMe));
accountRouter.post('/password', requireUserAuth, passwordCheckLimiter, withUser(updatePassword)); // The limiter is per user, so it has to come after requireUserAuth (which sets req.user).
accountRouter.delete('/me', requireUserAuth, passwordCheckLimiter, withUser(deleteMe)); // Same limiter, same budget: both routes let a session holder guess the current password.
accountRouter.post('/email/verify', emailVerifyLimiter, verifyEmail); // No session: the token in the body is the credential (the link is opened from a mail, maybe on another device).
accountRouter.post('/email/verification', requireUserAuth, emailVerificationRequestLimiter, withUser(resendEmailVerification)); // Per user again, so after requireUserAuth.
accountRouter.post('/password/reset-request', passwordResetRequestIpLimiter, passwordResetRequestEmailLimiter, requestPasswordReset); // Password reset: signed out, because whoever asks has forgotten the password. Not behind loginLimiter (that one counts login attempts); each route has its own limiters.
accountRouter.post('/password/reset', passwordResetLimiter, resetPassword); // No session either: the token in the body is the credential (the link is opened from a mail, maybe on another device).

export default accountRouter;
