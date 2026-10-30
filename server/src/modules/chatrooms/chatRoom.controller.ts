import type { Response, NextFunction } from 'express';
import type { AuthenticatedRequest } from '../../middlewares/UserSessionAuth';
import type { ChatRoomRequest } from './chatRoomAuth.middleware';
import type { ApiErrorBody } from '../../contract/errors';
import type {
  AddMembersResponse, ChatMessageResponse, ChatRoomDetailResponse, ChatRoomListResponse, CreatedChatRoomResponse,
  MarkReadResponse, MemberListResponse, MemberResponse, MessageListResponse
} from '../../contract/responses';
import {
  validateCreateChatRoomInput, validateUpdateChatRoomBody, validateAddMembersBody,
  validateUserIdParam, validateChangeMemberRoleBody, validateSendMessageBody,
  validateGetMessagesQuery, validateMessageIdParam, validateEditMessageBody, validateMarkReadBody
} from './chatRoom.validator';
import {
  addMembersToExistingChatRoom, removeMemberFromChatRoom, changeMemberRoleInChatRoom,
  getMembersForChatRoom, markChatRoomRead
} from './chatMember.service';
import {
  createChatRoom as createChatRoomService, updateChatRoomById,
  getDirectChatRoomsForUser, getGroupChatRoomsForUser, getChatRoomSummaryForUser, activityTimestamp,
  deleteChatRoomById, isForeignKeyConstraintError
} from './chatRoom.service';
import { createMessage, getMessagesForChatRoom, deleteMessage, editMessage } from './message.service';
import { toChatRoomDetail, toChatRoomSummary, toCreatedChatRoom, toMessage } from './chatRoom.serializer';

// One body for every refusal of the friendship rule. It does not say which ID was refused or why, so
// a stranger and a user who does not exist look the same.
const NOT_FRIENDS_ERROR = 'Only your friends can be added to a chat room';
const CHAT_ROOM_NOT_FOUND = 'Chat room not found';

export async function createChatRoom(req: AuthenticatedRequest, res: Response<CreatedChatRoomResponse | ApiErrorBody>) {
  const requesterId = req.user.id;

  const validation = validateCreateChatRoomInput(req.body, requesterId);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.message });
  }
  const { type, memberIds, name, avatarUrl } = validation;

  try {
    const result = await createChatRoomService(type, requesterId, memberIds, name, avatarUrl);

    if (result.status === 'not_friends') {
      return res.status(403).json({ error: NOT_FRIENDS_ERROR });
    }

    // The room as its creator sees it. For a direct room that is the other member's name and avatar,
    // and a reused room has the messages it already has.
    const { room, created } = result;
    const me = room.members.find((member) => member.member.id === requesterId);
    const summary = await getChatRoomSummaryForUser(requesterId, room.id, room.type);
    if (!me || !summary) {
      return res.status(404).json({ error: CHAT_ROOM_NOT_FOUND });
    }

    return res.status(created ? 201 : 200).json({ chatRoom: toCreatedChatRoom(summary, me.role, room.members) });
  } catch (err) {
    if (isForeignKeyConstraintError(err)) {
      // A member_ids user was deleted after the friendship check, so they are
      // no longer a friend.
      return res.status(403).json({ error: NOT_FRIENDS_ERROR });
    }
    throw err;
  }
}

export async function getChatRooms(req: AuthenticatedRequest, res: Response<ChatRoomListResponse>, next: NextFunction) {
  try {
    const userId = req.user.id;

    const [directRooms, groupRooms] = await Promise.all([
      getDirectChatRoomsForUser(userId),
      getGroupChatRoomsForUser(userId),
    ]);

    const chatRooms = [...directRooms, ...groupRooms].sort(
      (a, b) => activityTimestamp(b) - activityTimestamp(a)
    );

    res.json({ chatRooms: chatRooms.map(toChatRoomSummary) });
  } catch (err) {
    next(err);
  }
}

export async function getChatRoomById(req: ChatRoomRequest, res: Response<ChatRoomDetailResponse | ApiErrorBody>, next: NextFunction) {
  try {
    const userId = req.user.id;
    const { chatId, roomType, role } = req.chatMembership;

    const room = await getChatRoomSummaryForUser(userId, chatId, roomType);

    // The room can be gone by now: deleted, or the requester removed from it, since loadChatMembership ran.
    if (!room) {
      return res.status(404).json({ error: CHAT_ROOM_NOT_FOUND });
    }

    res.json({ chatRoom: toChatRoomDetail(room, role) });
  } catch (err) {
    next(err);
  }
}

export async function updateChatRoom(req: ChatRoomRequest, res: Response<ChatRoomDetailResponse | ApiErrorBody>, next: NextFunction) {
  const validation = validateUpdateChatRoomBody(req.body);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.message });
  }

  try {
    const { chatId, roomType, role } = req.chatMembership;
    await updateChatRoomById(chatId, validation.data);

    const room = await getChatRoomSummaryForUser(req.user.id, chatId, roomType);
    if (!room) {
      return res.status(404).json({ error: CHAT_ROOM_NOT_FOUND });
    }

    res.status(200).json({ chatRoom: toChatRoomDetail(room, role) });
  } catch (err) {
    next(err);
  }
}

export async function deleteChatRoom(req: ChatRoomRequest, res: Response<ApiErrorBody>, next: NextFunction) {
  try {
    await deleteChatRoomById(req.chatMembership.chatId);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

export async function addChatRoomMembers(req: ChatRoomRequest, res: Response<AddMembersResponse | ApiErrorBody>, next: NextFunction) {
  const validation = validateAddMembersBody(req.body);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.message });
  }

  try {
    const result = await addMembersToExistingChatRoom(
      req.chatMembership.chatId,
      req.user.id,
      validation.data.memberIds
    );

    if (result.status === 'not_friends') {
      return res.status(403).json({ error: NOT_FRIENDS_ERROR });
    }

    const { addedMembers, alreadyMemberIds } = result;

    return res
      .status(addedMembers.length > 0 ? 201 : 200)
      .json({ addedMembers, alreadyMemberIds });
  } catch (err) {
    if (isForeignKeyConstraintError(err)) {
      // A member_ids user was deleted after the friendship check, so they are
      // no longer a friend; nobody was added.
      return res.status(403).json({ error: NOT_FRIENDS_ERROR });
    }
    next(err);
  }
}

export async function removeChatRoomMember(req: ChatRoomRequest, res: Response<ApiErrorBody>, next: NextFunction) {
  const validation = validateUserIdParam(req.params.userid);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.message });
  }

  const { chatId, role, roomType } = req.chatMembership;
  const targetId = validation.data.userId;

  if (targetId !== req.user.id) {
    // Direct rooms make both users admins, so the role check below can't
    // catch this case on its own - the room type has to be checked first.
    if (roomType === 'direct') {
      return res
        .status(403)
        .json({ error: 'You can only remove yourself from a direct chat room' });
    }
    if (role !== 'admin') {
      return res.status(403).json({ error: 'Admin role required for this action' });
    }
  }

  try {
    const result = await removeMemberFromChatRoom(chatId, targetId, roomType);

    switch (result) {
      case 'removed':
        return res.status(204).end();
      case 'not_a_member':
        return res.status(404).json({ error: 'Member not found in this chat room' });
      case 'only_admin':
        return res.status(409).json({
          error:
            'The only admin cannot be removed while other members remain; promote another member to admin first',
        });
      case 'private_room':
        return res.status(403).json({ error: 'You cannot leave your private chat room' });
    }
  } catch (err) {
    next(err);
  }
}

export async function changeChatRoomMemberRole(req: ChatRoomRequest, res: Response<MemberResponse | ApiErrorBody>, next: NextFunction) {
  const idValidation = validateUserIdParam(req.params.userid);
  if (!idValidation.valid) {
    return res.status(400).json({ error: idValidation.message });
  }
  const bodyValidation = validateChangeMemberRoleBody(req.body);
  if (!bodyValidation.valid) {
    return res.status(400).json({ error: bodyValidation.message });
  }

  const targetId = idValidation.data.userId;
  const { role } = bodyValidation.data;

  try {
    const result = await changeMemberRoleInChatRoom(req.chatMembership.chatId, targetId, role);

    switch (result.outcome) {
      case 'updated':
        return res.status(200).json({ member: result.member });
      case 'not_a_member':
        return res.status(404).json({ error: 'Member not found in this chat room' });
      case 'only_admin':
        return res.status(409).json({
          error:
            'The only admin cannot be demoted while other members remain; promote another member to admin first',
        });
    }
  } catch (err) {
    next(err);
  }
}

export async function sendChatRoomMessage(req: ChatRoomRequest, res: Response<ChatMessageResponse | ApiErrorBody>, next: NextFunction) {
  const validation = validateSendMessageBody(req.body);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.message });
  }

  try {
    const message = await createMessage(
      req.chatMembership.chatId,
      req.user.id,
      validation.data.content
    );

    return res.status(201).json({ message: toMessage(message) });
  } catch (err) {
    next(err);
  }
}

export async function getChatRoomMessages(req: ChatRoomRequest, res: Response<MessageListResponse | ApiErrorBody>, next: NextFunction) {
  const validation = validateGetMessagesQuery(req.query);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.message });
  }

  try {
    const { limit, ...cursor } = validation.data;
    const { messages, hasMore } = await getMessagesForChatRoom(req.chatMembership.chatId, limit, cursor);

    return res.status(200).json({ messages: messages.map(toMessage), hasMore });
  } catch (err) {
    next(err);
  }
}

export async function deleteChatRoomMessage(req: ChatRoomRequest, res: Response<ApiErrorBody>, next: NextFunction) {
  const validation = validateMessageIdParam(req.params.message_id);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.message });
  }

  try {
    const result = await deleteMessage(
      req.chatMembership.chatId,
      validation.data.messageId,
      req.user.id
    );

    switch (result) {
      case 'deleted':
        return res.status(204).end();
      case 'not_found':
        return res.status(404).json({ error: 'Message not found in this chat room' });
      case 'forbidden':
        return res.status(403).json({ error: 'You can only delete your own messages' });
    }
  } catch (err) {
    next(err);
  }
}

export async function editChatRoomMessage(req: ChatRoomRequest, res: Response<ChatMessageResponse | ApiErrorBody>, next: NextFunction) {
  const idValidation = validateMessageIdParam(req.params.message_id);
  if (!idValidation.valid) {
    return res.status(400).json({ error: idValidation.message });
  }

  const bodyValidation = validateEditMessageBody(req.body);
  if (!bodyValidation.valid) {
    return res.status(400).json({ error: bodyValidation.message });
  }

  try {
    const result = await editMessage(
      req.chatMembership.chatId,
      idValidation.data.messageId,
      req.user.id,
      bodyValidation.data.content
    );

    switch (result.status) {
      case 'edited':
      case 'unchanged':
        return res.status(200).json({ message: toMessage(result.message) });
      case 'not_found':
        return res.status(404).json({ error: 'Message not found in this chat room' });
      case 'forbidden':
        return res.status(403).json({ error: 'You can only edit your own messages' });
    }
  } catch (err) {
    next(err);
  }
}

export async function getChatRoomMembers(req: ChatRoomRequest, res: Response<MemberListResponse>, next: NextFunction) {
  try {
    const members = await getMembersForChatRoom(req.chatMembership.chatId);

    return res.status(200).json({ members });
  } catch (err) {
    next(err);
  }
}

export async function markChatRoomAsRead(req: ChatRoomRequest, res: Response<MarkReadResponse | ApiErrorBody>, next: NextFunction) {
  const validation = validateMarkReadBody(req.body);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.message });
  }

  try {
    const result = await markChatRoomRead(
      req.chatMembership.chatId,
      req.user.id,
      validation.data.messageId
    );

    switch (result.outcome) {
      case 'marked':
        return res.status(200).json({ lastReadMessageId: result.lastReadMessageId });
      case 'message_not_found':
        return res.status(404).json({ error: 'Message not found in this chat room' });
      case 'not_a_member':
        // Left the room while this request was running: same answer as
        // loadChatMembership gives a user who is not in the room.
        return res.status(404).json({ error: CHAT_ROOM_NOT_FOUND });
    }
  } catch (err) {
    next(err);
  }
}
