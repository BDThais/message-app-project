import { ChatMemberRole } from '../generated/prisma/client';

/**
 * Minimal shape needed to write chat_members rows. Both the main `prisma`
 * client and a `$transaction` callback's `tx` client satisfy this
 * structurally, so the same function works standalone or as part of an
 * atomic transaction — no explicit Prisma transaction type import needed.
 */
interface ChatMemberWriteClient {
  chatMember: {
    createMany: (args: {
      data: { chatId: number; memberId: number; role: ChatMemberRole }[];
      skipDuplicates?: boolean;
    }) => Promise<{ count: number }>;
  };
}

/**
 * Adds one or more users to a chat room as chat members with the given role.
 *
 * Reused by:
 * - POST /chatrooms (room creation) — called inside a transaction alongside
 *   the ChatRoom insert, so the room and its initial members are created
 *   atomically.
 * - POST /chatrooms/:chatid/members (future) — called directly with the
 *   main `prisma` client, using the default role: 'member'.
 */
export async function addChatRoomMembers(
  client: ChatMemberWriteClient,
  chatId: number,
  memberIds: number[],
  role: ChatMemberRole = ChatMemberRole.member
) {
  if (memberIds.length === 0) {
    return { count: 0 };
  }

  return client.chatMember.createMany({
    data: memberIds.map((memberId) => ({ chatId, memberId, role })),
    skipDuplicates: true,
  });
}