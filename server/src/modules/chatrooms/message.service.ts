import { prisma } from '../../lib/prisma';
import type { Prisma } from '../../generated/prisma/client';

const senderSelect = { id: true, name: true, avatarUrl: true } as const;

export type MessageWithSender = Prisma.MessageGetPayload<{
  include: { sender: { select: typeof senderSelect } };
}>;

/**
 * Creates a new message in a chat room (POST /chatrooms/:chatid/messages).
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
