import { ChatMemberRole, ChatRoomType, type Prisma } from '../../generated/prisma/client';

/**
 * Gives the user their private room: a room of type `private` with the user as its only member, and
 * as its admin, as in every room whose members all are. Call it in the transaction that creates the
 * user, so an account never exists without its room.
 */
export async function createPrivateChatRoom(tx: Prisma.TransactionClient, userId: number): Promise<void> {
  await tx.chatRoom.create({
    data: {
      type: ChatRoomType.private,
      members: { create: [{ memberId: userId, role: ChatMemberRole.admin }] },
    },
  });
}

/** The ids of the user's private rooms. Read it before the user is deleted: afterwards nothing links them. */
export async function findPrivateChatRoomIds(tx: Prisma.TransactionClient, userId: number): Promise<number[]> {
  const rooms = await tx.chatRoom.findMany({
    where: { type: ChatRoomType.private, members: { some: { memberId: userId } } },
    select: { id: true },
  });
  return rooms.map(({ id }) => id);
}
