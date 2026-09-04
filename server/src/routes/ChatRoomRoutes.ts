import Router from 'express';
import { requireAuth } from '../middlewares/AuthMiddleware';
import { createChatRoom } from '../controllers/ChatRoomControllers';

const chatRoomRouter = Router();

chatRoomRouter.use(requireAuth);

chatRoomRouter.post('/', createChatRoom);
chatRoomRouter.get('/', (req, res) => {});

export default chatRoomRouter;