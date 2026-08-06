import Router from 'express';
import {createAccount} from '../controllers/AccountControllers';

const accountRouter = Router();

accountRouter.post('/signup', createAccount);
// accountRouter.post('/login', (req, res) => {});
// accountRouter.post('/logout', (req, res) => {});
// accountRouter.get('/me', (req, res) => {});

export default accountRouter;