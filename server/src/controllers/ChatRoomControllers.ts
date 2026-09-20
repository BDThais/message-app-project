import type { Request, Response, NextFunction } from 'express';
import {
  validateCreateChatRoomInput, validateUpdateChatRoomBody, validateAddMembersBody,
  validateUserIdParam
} from './ChatRoomValidators';
import { addMembersToExistingChatRoom, removeMemberFromChatRoom } from '../services/ChatMemberServices';
import {
  createChatRoom as createChatRoomService, updateChatRoomById,
  getDirectChatRoomsForUser, getGroupChatRoomsForUser, activityTimestamp,
  deleteChatRoomById, isForeignKeyConstraintError
} from '../services/ChatRoomServices';

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
    const { room, created } = await createChatRoomService(
      type,
      requesterId,
      memberIds,
      name,
      avatarUrl
    );

    return res.status(created ? 201 : 200).json(room);
  } catch (err) {
    if (isForeignKeyConstraintError(err)) {
      // One of the member_ids doesn't refer to a real user.
      return res
        .status(400)
        .json({ error: 'one or more member_ids do not refer to an existing user' });
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
    return res.status(400).json({ message: validation.message });
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
    return res.status(400).json({ message: validation.message });
  }

  try {
    const { addedMembers, alreadyMemberIds } = await addMembersToExistingChatRoom(
      req.chatMembership!.chatId,
      validation.data.memberIds
    );

    // Same convention as POST /chatrooms: 201 when something was created,
    // 200 when the request changed nothing (everyone was already a member).
    return res
      .status(addedMembers.length > 0 ? 201 : 200)
      .json({ addedMembers, alreadyMemberIds });
  } catch (err) {
    if (isForeignKeyConstraintError(err)) {
      // One of the member_ids doesn't refer to a real user; nobody was added.
      return res
        .status(400)
        .json({ message: 'one or more member_ids do not refer to an existing user' });
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
    return res.status(400).json({ message: validation.message });
  }

  const { chatId, role, roomType } = req.chatMembership!;
  const targetId = validation.data.userId;

  if (targetId !== req.user!.id) {
    // Direct rooms make both users admins, so the role check below can't
    // catch this case on its own - the room type has to be checked first.
    if (roomType === 'direct') {
      return res
        .status(403)
        .json({ message: 'You can only remove yourself from a direct chat room' });
    }
    if (role !== 'admin') {
      return res.status(403).json({ message: 'Admin role required for this action' });
    }
  }

  try {
    const result = await removeMemberFromChatRoom(chatId, targetId, roomType);

    switch (result) {
      case 'removed':
        return res.status(204).end();
      case 'not_a_member':
        return res.status(404).json({ message: 'Member not found in this chat room' });
      case 'only_admin':
        return res.status(409).json({
          message:
            'The only admin cannot be removed while other members remain; promote another member to admin first',
        });
    }
  } catch (err) {
    next(err);
  }
}
