import { prisma } from '../../lib/prisma';
import { Prisma } from '../../generated/prisma/client';

const senderSelect = { id: true, name: true, avatarUrl: true } as const;

export type MessageWithSender = Prisma.MessageGetPayload<{
  include: { sender: { select: typeof senderSelect } };
}>;

/**
 * Creates a message. There is no membership check: chatId and senderId come from req.chatMembership
 * and req.user, which loadChatMembership has already vouched for.
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
 * A page of messages, always listed newest first. Without a cursor it is the newest page; with
 * `before` it is the page of messages older than that id, and `hasMore` says there are still older ones.
 * With `after` it is the other direction: the `limit` OLDEST messages newer than that id, so that
 * a client that holds everything up to a message can fetch the rest in order, and `hasMore` says
 * there are still newer ones (ask again with `after` set to the newest id of this page). It fetches
 * one row more than asked for, to know `hasMore` without a separate count query.
 */
export async function getMessagesForChatRoom(
  chatId: number,
  limit: number,
  cursor: { before?: number; after?: number } = {}
): Promise<MessagesPage> {
  const { before, after } = cursor;
  const forward = after !== undefined;
  const rows = await prisma.message.findMany({
    where: {
      chatId,
      ...(forward ? { id: { gt: after } } : before !== undefined ? { id: { lt: before } } : {}),
    },
    orderBy: { id: forward ? 'asc' : 'desc' },
    take: limit + 1,
    include: { sender: { select: senderSelect } },
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  return { messages: forward ? page.reverse() : page, hasMore };
}

export type DeleteMessageResult =
  | 'deleted'
  // No message with this id in this room, or it was already deleted.
  | 'not_found'
  // The requester didn't send this message.
  | 'forbidden';

/** Soft delete: the row stays, `content` is cleared and `deletedAt` stamped. Only the sender may. */
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

export type EditMessageResult =
  // `edited`: the content changed and `editedAt` was stamped. `unchanged`: the new content equals the
  // current one and nothing was written, so a broadcast of edits can skip it.
  | { status: 'edited' | 'unchanged'; message: MessageWithSender }
  // No message with this id in this room, or it was deleted.
  | { status: 'not_found' }
  // The requester didn't send this message.
  | { status: 'forbidden' };

/**
 * Edits a message's content and stamps `editedAt`. `content` is already validated and trimmed by
 * validateEditMessageBody. Saving the content the message already has is not an edit: it returns
 * `unchanged` without touching the row, so `editedAt` never gets stamped on a message that visibly
 * did not change.
 */
export async function editMessage(
  chatId: number,
  messageId: number,
  requesterId: number,
  content: string
): Promise<EditMessageResult> {
  const message = await prisma.message.findUnique({
    where: { id: messageId },
    include: { sender: { select: senderSelect } },
  });

  if (!message || message.chatId !== chatId || message.deletedAt !== null) {
    return { status: 'not_found' };
  }
  if (message.senderId !== requesterId) {
    return { status: 'forbidden' };
  }
  if (message.content === content) {
    return { status: 'unchanged', message };
  }

  try {
    // `deletedAt: null` is repeated in the write itself: if the sender
    // deleted the message in another tab after the read above, this update
    // matches nothing (instead of writing new content into a deleted row).
    const edited = await prisma.message.update({
      where: { id: messageId, deletedAt: null },
      data: { content, editedAt: new Date() },
      include: { sender: { select: senderSelect } },
    });

    return { status: 'edited', message: edited };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      return { status: 'not_found' };
    }
    throw err;
  }
}
