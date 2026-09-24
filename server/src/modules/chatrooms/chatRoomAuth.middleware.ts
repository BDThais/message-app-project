import type { NextFunction, Request, Response } from 'express';
import { getChatMembership } from './chatRoom.service';
import { validateChatIdParam } from './chatRoom.validator';

// Attached by loadChatMembership below on any route with a ':chatid'
// param. Every handler downstream can trust this is populated - if it
// weren't, loadChatMembership would have already 404'd the request.
declare global {
  namespace Express {
    interface Request {
      chatMembership?: {
        chatId: number;
        role: 'admin' | 'member';
        roomType: 'direct' | 'group';
      };
    }
  }
}

/**
 * Register once per router that has ':chatid' routes:
 *   router.param('chatid', loadChatMembership);
 * Confirms the room exists *and* the requester is a member of it in a
 * single query, then attaches the result to req.chatMembership. 404s
 * either way otherwise, so a non-member can't tell a real room id from
 * a made-up one.
 */
export async function loadChatMembership(
  req: Request,
  res: Response,
  next: NextFunction,
  rawChatId: string
) {
  const validation = validateChatIdParam(rawChatId);
  if (!validation.valid) {
    return res.status(400).json({ message: validation.message });
  }
  const { chatId } = validation.data;

  try {
    const membership = await getChatMembership(req.user!.id, chatId);

    if (!membership) {
      return res.status(404).json({ message: 'Chat room not found' });
    }

    req.chatMembership = {
      chatId,
      role: membership.role,
      roomType: membership.chatRoom.type,
    };

    next();
  } catch (err) {
    next(err);
  }
}

/** Route guard: requester must be an admin of the room. */
export function requireChatAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.chatMembership?.role !== 'admin') {
    return res.status(403).json({ message: 'Admin role required for this action' });
  }
  next();
}

/**
 * Route guard for actions restricted to group rooms (rename, delete,
 * add members, remove someone else). Direct rooms make both members
 * admins by design, so requireChatAdmin alone won't catch this case -
 * this does.
 */
export function requireGroupRoom(req: Request, res: Response, next: NextFunction) {
  if (req.chatMembership?.roomType !== 'group') {
    return res.status(403).json({ message: 'Not available for direct chat rooms' });
  }
  next();
}
