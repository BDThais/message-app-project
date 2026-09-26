import Router from 'express';
import { requireUserAuth } from '../../middlewares/UserSessionAuth';
import {
    createChatRoom, getChatRooms, getChatRoomById, updateChatRoom, deleteChatRoom, addChatRoomMembers,
    removeChatRoomMember, changeChatRoomMemberRole, sendChatRoomMessage, getChatRoomMessages
} from './chatRoom.controller';
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
chatRoomRouter.post('/:chatid/member', requireGroupRoom, requireChatAdmin, addChatRoomMembers);
chatRoomRouter.delete('/:chatid/member/:userid', removeChatRoomMember); // No blanket guard: any member may remove themself; removing someone else is checked in the controller.
chatRoomRouter.patch('/:chatid/member/:userid', requireGroupRoom, requireChatAdmin, changeChatRoomMemberRole);

chatRoomRouter.post('/:chatid/message', sendChatRoomMessage); // membership alone is enough
chatRoomRouter.get('/:chatid/message', getChatRoomMessages); // membership alone is enough

export default chatRoomRouter;