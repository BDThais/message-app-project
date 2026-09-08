import Router from 'express';
import { requireAuth } from '../middlewares/UserSessionAuth';
import { createChatRoom, getChatRooms, getChatRoomById } from '../controllers/ChatRoomControllers';
import { loadChatMembership } from '../middlewares/ChatRoomAuth';

const chatRoomRouter = Router();

chatRoomRouter.use(requireAuth);

chatRoomRouter.param('chatid', loadChatMembership);

chatRoomRouter.post('/', createChatRoom);
chatRoomRouter.get('/', getChatRooms);
chatRoomRouter.get('/:chatid', getChatRoomById);

// chatRoomRouter.patch('/:chatid', requireGroupRoom, requireChatAdmin, updateChatRoom);
// chatRoomRouter.delete('/:chatid', requireGroupRoom, requireChatAdmin, deleteChatRoom);
// chatRoomRouter.post('/:chatid/members', requireGroupRoom, requireChatAdmin, addChatRoomMembers);
// chatRoomRouter.patch('/:chatid/members/:userid', requireChatAdmin, changeMemberRole);

// chatRoomRouter.get('/:chatid/messages', getChatRoomMessages);   // membership alone is enough
// chatRoomRouter.post('/:chatid/messages', sendChatRoomMessage);  // membership alone is enough

// chatRoomRouter.delete('/:chatid/members/:userid', removeChatRoomMember); // no blanket guard

export default chatRoomRouter;