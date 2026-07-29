import Router from 'express';

const accountRouter = Router();

accountRouter.post('/signup', (req, res) => {});
accountRouter.post('/login', (req, res) => {});
accountRouter.post('/logout', (req, res) => {});
accountRouter.get('/me', (req, res) => {});

export default accountRouter;