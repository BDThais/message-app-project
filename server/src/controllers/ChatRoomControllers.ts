import type { Request, Response, NextFunction } from 'express';
import { validateCreateChatRoomInput, validateUpdateChatRoomBody } from './ChatRoomValidators';
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