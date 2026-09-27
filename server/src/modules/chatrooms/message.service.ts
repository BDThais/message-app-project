import { prisma } from '../../lib/prisma';
import type { Prisma } from '../../generated/prisma/client';

const senderSelect = { id: true, name: true, avatarUrl: true } as const;

export type MessageWithSender = Prisma.MessageGetPayload<{
  include: { sender: { select: typeof senderSelect } };
}>;

/**
 * Creates a new message in a chat room (POST /chat/:chatid/message).
 * Membership is already guaranteed by loadChatMembership by the time this
 * runs - chatId comes from req.chatMembership and senderId from req.user, so
 * both are trusted to belong together and there's no membership check here.
 */
export async function createMessage(
  chatId: number,
  senderId: number,
  content: string
): Promise<MessageWithSender> {
  return prisma.message.create({
    data: { chatId, senderId, content },
    include: { sender: { select: senderSelect } },
  });
}

export type MessagesPage = {
  messages: MessageWithSender[];
  hasMore: boolean;
};

/**
 * Retrieves a page of messages for a chat room (GET /chat/:chatid/message),
 * newest first. When `before` is given, only messages with a smaller id are
 * returned, so paging further back means passing the id of the oldest
 * message already loaded. Fetches one extra row to determine `hasMore`
 * without a separate count query. Membership is already guaranteed by
 * loadChatMembership by the time this runs.
 */
export async function getMessagesForChatRoom(
  chatId: number,
  limit: number,
  before?: number
): Promise<MessagesPage> {
  const rows = await prisma.message.findMany({
    where: { chatId, ...(before !== undefined ? { id: { lt: before } } : {}) },
    orderBy: { id: 'desc' },
    take: limit + 1,
    include: { sender: { select: senderSelect } },
  });

  const hasMore = rows.length > limit;

  return { messages: hasMore ? rows.slice(0, limit) : rows, hasMore };
}

export type DeleteMessageResult =
  | 'deleted'
  // No message with this id in this room, or it was already deleted.
  | 'not_found'
  // The requester didn't send this message.
  | 'forbidden';

/**
 * Soft-deletes a message (DELETE /chat/:chatid/message/:message_id): the row
 * stays so its slot in the room's history isn't lost, but `deletedAt` is
 * stamped and `content` is cleared, so future reads (getMessagesForChatRoom)
 * report it as deleted instead of returning the original content. This is
 * the "delete for everyone" behavior described in project-planning-doc.md;
 * there is no separate "delete for me" mode.
 *
 * Deleting is limited to the message's own sender, in direct or group rooms
 * alike - there is no admin-moderation override for other members' messages
 * (see the permission model in project-planning-doc.md). Membership in
 * `chatId` is already guaranteed by loadChatMembership by the time this
 * runs; this only additionally confirms the message belongs to that room and
 * isn't already deleted.
 */
export async function deleteMessage(
  chatId: number,
  messageId: number,
  requesterId: number
): Promise<DeleteMessageResult> {
  const message = await prisma.message.findUnique({
    where: { id: messageId },
    select: { chatId: true, senderId: true, deletedAt: true },
  });

  if (!message || message.chatId !== chatId || message.deletedAt !== null) {
    return 'not_found';
  }
  if (message.senderId !== requesterId) {
    return 'forbidden';
  }

  await prisma.message.update({
    where: { id: messageId },
    data: { deletedAt: new Date(), content: '' },
  });

  return 'deleted';
}
