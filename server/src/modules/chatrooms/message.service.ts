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
