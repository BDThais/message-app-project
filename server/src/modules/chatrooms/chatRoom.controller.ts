import type { Request, Response, NextFunction } from 'express';
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
  getDirectChatRoomsForUser, getGroupChatRoomsForUser, activityTimestamp,
  deleteChatRoomById, isForeignKeyConstraintError
} from './chatRoom.service';
import { createMessage, getMessagesForChatRoom, deleteMessage, editMessage } from './message.service';

// One body for every refusal of the friendship rule (POST /chat and
// POST /chat/:chatid/member). It does not say which ID was refused or why, so
// a stranger and a user who does not exist look the same.
const NOT_FRIENDS_ERROR = 'Only your friends can be added to a chat room';

export async function createChatRoom(req: Request, res: Response) {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized Access' });
  }
  const requesterId = req.user.id;

  const validation = validateCreateChatRoomInput(req.body, requesterId);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.error });
  }
  const { type, memberIds, name, avatarUrl } = validation;

  try {
    const result = await createChatRoomService(type, requesterId, memberIds, name, avatarUrl);

    if (result.status === 'not_friends') {
      return res.status(403).json({ error: NOT_FRIENDS_ERROR });
    }

    return res.status(result.created ? 201 : 200).json(result.room);
  } catch (err) {
    if (isForeignKeyConstraintError(err)) {
      // A member_ids user was deleted after the friendship check, so they are
      // no longer a friend.
      return res.status(403).json({ error: NOT_FRIENDS_ERROR });
    }
    throw err;
  }
}

export async function getChatRooms(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.id;

    const [directRooms, groupRooms] = await Promise.all([
      getDirectChatRoomsForUser(userId),
      getGroupChatRoomsForUser(userId),
    ]);

    const chatRooms = [...directRooms, ...groupRooms].sort(
      (a, b) => activityTimestamp(b) - activityTimestamp(a)
    );

    res.json({ chatRooms });
  } catch (err) {
    next(err);
  }
}

// Existence + membership is already guaranteed by loadChatMembership
// (mounted via router.param('chatid', ...)) by the time this runs, so
// there's no 404 branch here and only the relevant one of the two
// fetchers below gets called.
export async function getChatRoomById(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.id;
    const { chatId, roomType, role } = req.chatMembership!;

    const [room] =
      roomType === 'direct'
        ? await getDirectChatRoomsForUser(userId, chatId)
        : await getGroupChatRoomsForUser(userId, chatId);

    res.json({ chatRoom: { ...room, role } });
  } catch (err) {
    next(err);
  }
}

export async function updateChatRoom(req: Request, res: Response, next: NextFunction) {
  const validation = validateUpdateChatRoomBody(req.body);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.message });
  }

  try {
    const chatRoom = await updateChatRoomById(req.chatMembership!.chatId, validation.data);

    res.status(200).json({
      chatRoom: {
        id: chatRoom.id,
        type: chatRoom.type,
        name: chatRoom.name,
        avatarUrl: chatRoom.avatarUrl,
        createdAt: chatRoom.createdAt,
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function deleteChatRoom(req: Request, res: Response, next: NextFunction) {
  try {
    await deleteChatRoomById(req.chatMembership!.chatId);
    res.status(204).json({ message: 'Chat room deleted' });
  } catch (err) {
    next(err);
  }
}

// Route chain (see ChatRoomRoutes.ts): loadChatMembership -> requireGroupRoom
// -> requireChatAdmin, so by the time this runs the room exists, is a group
// room, and the requester is one of its admins.
export async function addChatRoomMembers(req: Request, res: Response, next: NextFunction) {
  const validation = validateAddMembersBody(req.body);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.message });
  }

  try {
    const result = await addMembersToExistingChatRoom(
      req.chatMembership!.chatId,
      req.user!.id,
      validation.data.memberIds
    );

    if (result.status === 'not_friends') {
      return res.status(403).json({ error: NOT_FRIENDS_ERROR });
    }

    const { addedMembers, alreadyMemberIds } = result;

    // Same convention as POST /chat: 201 when something was created,
    // 200 when the request changed nothing (everyone was already a member).
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

// Route chain (see ChatRoomRoutes.ts): loadChatMembership only. There is no
// blanket requireGroupRoom / requireChatAdmin guard on this route because who
// may call it depends on who the target is:
//   - removing yourself (leaving) is allowed for every member, in any room;
//   - removing someone else needs a group room AND an admin requester.
// By the time this runs the room exists and the requester is a member of it.
export async function removeChatRoomMember(req: Request, res: Response, next: NextFunction) {
  const validation = validateUserIdParam(req.params.userid);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.message });
  }

  const { chatId, role, roomType } = req.chatMembership!;
  const targetId = validation.data.userId;

  if (targetId !== req.user!.id) {
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
    }
  } catch (err) {
    next(err);
  }
}

// Route chain (see chatRoom.routes.ts): loadChatMembership -> requireGroupRoom
// -> requireChatAdmin, so by the time this runs the room exists, is a group
// room, and the requester is one of its admins.
export async function changeChatRoomMemberRole(req: Request, res: Response, next: NextFunction) {
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
    const result = await changeMemberRoleInChatRoom(req.chatMembership!.chatId, targetId, role);

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

// Route chain (see chatRoom.routes.ts): loadChatMembership only - both admins
// and regular members may send messages, in direct or group rooms alike (see
// the permission model in project-planning-doc.md), so there's no
// requireGroupRoom / requireChatAdmin guard on this route. By the time this
// runs the room exists and the requester is a member of it.
export async function sendChatRoomMessage(req: Request, res: Response, next: NextFunction) {
  const validation = validateSendMessageBody(req.body);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.message });
  }

  try {
    const message = await createMessage(
      req.chatMembership!.chatId,
      req.user!.id,
      validation.data.content
    );

    return res.status(201).json({ message });
  } catch (err) {
    next(err);
  }
}

// Route chain (see chatRoom.routes.ts): loadChatMembership only - reading
// messages requires membership alone, in direct or group rooms alike, same
// as sending (see the permission model in project-planning-doc.md), so
// there's no requireGroupRoom / requireChatAdmin guard on this route. By the
// time this runs the room exists and the requester is a member of it.
export async function getChatRoomMessages(req: Request, res: Response, next: NextFunction) {
  const validation = validateGetMessagesQuery(req.query);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.message });
  }

  try {
    const { messages, hasMore } = await getMessagesForChatRoom(
      req.chatMembership!.chatId,
      validation.data.limit,
      validation.data.before
    );

    return res.status(200).json({ messages, hasMore });
  } catch (err) {
    next(err);
  }
}

// Route chain (see chatRoom.routes.ts): loadChatMembership only - deleting a
// message is limited to the sender (checked in the service below), in direct
// or group rooms alike, so there's no requireGroupRoom / requireChatAdmin
// guard on this route. By the time this runs the room exists and the
// requester is a member of it.
export async function deleteChatRoomMessage(req: Request, res: Response, next: NextFunction) {
  const validation = validateMessageIdParam(req.params.message_id);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.message });
  }

  try {
    const result = await deleteMessage(
      req.chatMembership!.chatId,
      validation.data.messageId,
      req.user!.id
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

// Route chain (see chatRoom.routes.ts): loadChatMembership only - editing a
// message is limited to the sender (checked in the service below), in direct
// or group rooms alike, so there's no requireGroupRoom / requireChatAdmin
// guard on this route. By the time this runs the room exists and the
// requester is a member of it.
export async function editChatRoomMessage(req: Request, res: Response, next: NextFunction) {
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
      req.chatMembership!.chatId,
      idValidation.data.messageId,
      req.user!.id,
      bodyValidation.data.content
    );

    switch (result.status) {
      case 'edited':
      case 'unchanged':
        return res.status(200).json({ message: result.message });
      case 'not_found':
        return res.status(404).json({ error: 'Message not found in this chat room' });
      case 'forbidden':
        return res.status(403).json({ error: 'You can only edit your own messages' });
    }
  } catch (err) {
    next(err);
  }
}

// Route chain (see chatRoom.routes.ts): loadChatMembership only - listing the
// members takes membership alone, in direct or group rooms alike, so there's no
// requireGroupRoom / requireChatAdmin guard on this route. By the time this
// runs the room exists and the requester is a member of it.
export async function getChatRoomMembers(req: Request, res: Response, next: NextFunction) {
  try {
    const members = await getMembersForChatRoom(req.chatMembership!.chatId);

    return res.status(200).json({ members });
  } catch (err) {
    next(err);
  }
}

// Route chain (see chatRoom.routes.ts): loadChatMembership only - every member
// has their own read marker, in direct or group rooms alike, so there's no
// requireGroupRoom / requireChatAdmin guard on this route. By the time this
// runs the room exists and the requester is a member of it.
export async function markChatRoomAsRead(req: Request, res: Response, next: NextFunction) {
  const validation = validateMarkReadBody(req.body);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.message });
  }

  try {
    const result = await markChatRoomRead(
      req.chatMembership!.chatId,
      req.user!.id,
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
        return res.status(404).json({ error: 'Chat room not found' });
    }
  } catch (err) {
    next(err);
  }
}
