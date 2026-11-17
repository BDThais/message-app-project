import { Router } from 'express';
import { getHealth, getReadiness } from './health.controller';

const healthRouter = Router();

// No session and no rate limit: a host or a monitor asks every few seconds, from no account.
healthRouter.get('/', getHealth);
healthRouter.get('/ready', getReadiness);

export default healthRouter;
