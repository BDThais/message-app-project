import Router from 'express';
import { requireAuth } from '../middlewares/AuthMiddleware';
import { createChatRoom, getChatRooms } from '../controllers/ChatRoomControllers';

const chatRoomRouter = Router();

chatRoomRouter.use(requireAuth);

chatRoomRouter.post('/', createChatRoom);
chatRoomRouter.get('/', getChatRooms);

export default chatRoomRouter;