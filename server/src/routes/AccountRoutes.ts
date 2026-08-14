import Router from 'express';
import {createAccount, login, logout, me} from '../controllers/AccountControllers';

const accountRouter = Router();

accountRouter.post('/signup', createAccount);
accountRouter.post('/login', login);
accountRouter.post('/logout', logout);
accountRouter.get('/me', me);

export default accountRouter;