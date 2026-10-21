import Router from 'express';
import { requireUserAuth, withUser } from '../../middlewares/UserSessionAuth';
import {
    createChatRoom, getChatRooms, getChatRoomById, updateChatRoom, deleteChatRoom, addChatRoomMembers,
    removeChatRoomMember, changeChatRoomMemberRole, sendChatRoomMessage, getChatRoomMessages,
    editChatRoomMessage, deleteChatRoomMessage, getChatRoomMembers, markChatRoomAsRead
} from './chatRoom.controller';
import { loadChatMembership, requireGroupRoom, requireChatAdmin, withChatMembership } from './chatRoomAuth.middleware';

const chatRoomRouter = Router();

chatRoomRouter.use(requireUserAuth);

chatRoomRouter.param('chatid', loadChatMembership);

chatRoomRouter.post('/', withUser(createChatRoom));
chatRoomRouter.get('/', withUser(getChatRooms));
chatRoomRouter.get('/:chatid', withChatMembership(getChatRoomById));

chatRoomRouter.patch('/:chatid', requireGroupRoom, requireChatAdmin, withChatMembership(updateChatRoom));
chatRoomRouter.delete('/:chatid', requireGroupRoom, requireChatAdmin, withChatMembership(deleteChatRoom));
chatRoomRouter.get('/:chatid/member', withChatMembership(getChatRoomMembers)); // membership alone is enough, direct or group
chatRoomRouter.post('/:chatid/member', requireGroupRoom, requireChatAdmin, withChatMembership(addChatRoomMembers));
chatRoomRouter.delete('/:chatid/member/:userid', withChatMembership(removeChatRoomMember)); // No blanket guard: any member may remove themself (leave); removing someone else needs a group room and an admin, checked in the controller.
chatRoomRouter.patch('/:chatid/member/:userid', requireGroupRoom, requireChatAdmin, withChatMembership(changeChatRoomMemberRole));

chatRoomRouter.post('/:chatid/message', withChatMembership(sendChatRoomMessage)); // membership alone is enough
chatRoomRouter.get('/:chatid/message', withChatMembership(getChatRoomMessages)); // membership alone is enough
chatRoomRouter.patch('/:chatid/message/:message_id', withChatMembership(editChatRoomMessage)); // membership alone is enough; sender-only check is in the service
chatRoomRouter.delete('/:chatid/message/:message_id', withChatMembership(deleteChatRoomMessage)); // membership alone is enough; sender-only check is in the service

chatRoomRouter.put('/:chatid/read', withChatMembership(markChatRoomAsRead)); // membership alone is enough; moves the requester's own marker

export default chatRoomRouter;