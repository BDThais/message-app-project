import Router from 'express';
import { requireUserAuth } from '../../middlewares/UserSessionAuth';
import {
    createChatRoom, getChatRooms, getChatRoomById, updateChatRoom, deleteChatRoom, addChatRoomMembers,
    removeChatRoomMember, changeChatRoomMemberRole, sendChatRoomMessage, getChatRoomMessages,
    editChatRoomMessage, deleteChatRoomMessage, getChatRoomMembers, markChatRoomAsRead
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
chatRoomRouter.get('/:chatid/member', getChatRoomMembers); // membership alone is enough, direct or group
chatRoomRouter.post('/:chatid/member', requireGroupRoom, requireChatAdmin, addChatRoomMembers);
chatRoomRouter.delete('/:chatid/member/:userid', removeChatRoomMember); // No blanket guard: any member may remove themself; removing someone else is checked in the controller.
chatRoomRouter.patch('/:chatid/member/:userid', requireGroupRoom, requireChatAdmin, changeChatRoomMemberRole);

chatRoomRouter.post('/:chatid/message', sendChatRoomMessage); // membership alone is enough
chatRoomRouter.get('/:chatid/message', getChatRoomMessages); // membership alone is enough
chatRoomRouter.patch('/:chatid/message/:message_id', editChatRoomMessage); // membership alone is enough; sender-only check is in the service
chatRoomRouter.delete('/:chatid/message/:message_id', deleteChatRoomMessage); // membership alone is enough; sender-only check is in the controller/service

chatRoomRouter.put('/:chatid/read', markChatRoomAsRead); // membership alone is enough; moves the requester's own marker

export default chatRoomRouter;