import { ChatMemberRole, ChatRoomType, type Prisma } from '../../generated/prisma/client';

/**
 * The hidden account that is the other member of every user's private chat room. The migration
 * `add_private_chat_room` creates it; this is the one value the code needs to find it.
 */
export const PRIVATE_ROOM_BOT_EMAIL = 'my-documents@bot.invalid';

/**
 * Gives the user their private room: a direct room with the user and the bot as its two admins, as
 * in every direct room. Call it in the transaction that creates the user, so an account never exists
 * without its room. Connecting the bot by its email makes the transaction fail (and the user not be
 * created) if the migration's bot row is missing.
 */
export async function createPrivateChatRoom(tx: Prisma.TransactionClient, userId: number): Promise<void> {
  await tx.chatRoom.create({
    data: {
      type: ChatRoomType.direct,
      members: {
        create: [
          { role: ChatMemberRole.admin, member: { connect: { id: userId } } },
          { role: ChatMemberRole.admin, member: { connect: { email: PRIVATE_ROOM_BOT_EMAIL } } },
        ],
      },
    },
  });
}

/** A room is private when the bot is in it: no other room can have a bot member, since nobody can add one. */
export async function isPrivateChatRoom(tx: Prisma.TransactionClient, chatId: number): Promise<boolean> {
  return (await tx.chatMember.count({ where: { chatId, member: { isBot: true } } })) > 0;
}

/** The ids of the rooms the user shares with the bot. Read it before the user is deleted: afterwards nothing links them. */
export async function findPrivateChatRoomIds(tx: Prisma.TransactionClient, userId: number): Promise<number[]> {
  const rooms = await tx.chatRoom.findMany({
    where: { AND: [{ members: { some: { memberId: userId } } }, { members: { some: { member: { isBot: true } } } }] },
    select: { id: true },
  });
  return rooms.map(({ id }) => id);
}
