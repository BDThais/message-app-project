import Router from 'express';
import {createAccount, login, logout, me} from '../controllers/AccountControllers';
import { loginLimiter } from '../middlewares/RateLimiter';

const accountRouter = Router();

accountRouter.post('/signup', createAccount);
accountRouter.post('/login', loginLimiter, login);
accountRouter.post('/logout', logout);
accountRouter.get('/me', me);

export default accountRouter;