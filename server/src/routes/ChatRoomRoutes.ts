import Router from 'express';
import { requireAuth } from '../middlewares/AuthMiddleware';

const chatRoomRouter = Router();

chatRoomRouter.use(requireAuth);

chatRoomRouter.get('/', (req, res) => {});
chatRoomRouter.post('/', (req, res) => {});
chatRoomRouter.get('/:chatid/messages', (req, res) => {});
chatRoomRouter.post('/:chatid/messages', (req, res) => {});

export default chatRoomRouter;