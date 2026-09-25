import Router from 'express';
import { requireUserAuth } from '../../middlewares/UserSessionAuth';
import { createChatRoom, getChatRooms, getChatRoomById, updateChatRoom, deleteChatRoom, addChatRoomMembers, removeChatRoomMember, changeChatRoomMemberRole } from './chatRoom.controller';
import { loadChatMembership } from './chatRoomAuth.middleware';
import { requireGroupRoom, requireChatAdmin } from './chatRoomAuth.middleware';

const chatRoomRouter = Router();

chatRoomRouter.use(requireUserAuth);

chatRoomRouter.param('chatid', loadChatMembership);

chatRoomRouter.post('/', createChatRoom);
chatRoomRouter.get('/', getChatRooms);
chatRoomRouter.get('/:chatid', getChatRoomById);

chatRoomRouter.patch('/:chatid', requireGroupRoom, requireChatAdmin, updateChatRoom);
chatRoomRouter.delete('/:chatid', requireGroupRoom, requireChatAdmin, deleteChatRoom);
chatRoomRouter.post('/:chatid/members', requireGroupRoom, requireChatAdmin, addChatRoomMembers);
chatRoomRouter.delete('/:chatid/members/:userid', removeChatRoomMember); // No blanket guard: any member may remove themself; removing someone else is checked in the controller.
chatRoomRouter.patch('/:chatid/members/:userid', requireGroupRoom, requireChatAdmin, changeChatRoomMemberRole);

// chatRoomRouter.get('/:chatid/messages', getChatRoomMessages);   // membership alone is enough
// chatRoomRouter.post('/:chatid/messages', sendChatRoomMessage);  // membership alone is enough

export default chatRoomRouter;