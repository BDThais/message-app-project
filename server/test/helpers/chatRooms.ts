import { prisma } from '../../src/lib/prisma';

/** A group room with `adminId` as its admin and `memberIds` as regular members. */
export async function createGroupRoom(adminId: number, memberIds: number[] = [], name = 'Project chat') {
  const room = await prisma.chatRoom.create({
    data: { type: 'group', name },
  });

  await prisma.chatMember.createMany({
    data: [
      { chatId: room.id, memberId: adminId, role: 'admin' },
      ...memberIds.map((memberId) => ({ chatId: room.id, memberId, role: 'member' as const })),
    ],
  });

  return room;
}

/** A direct room; like the real endpoint, it makes both users admins. */
export async function createDirectRoom(userAId: number, userBId: number) {
  return prisma.chatRoom.create({
    data: {
      type: 'direct',
      members: {
        create: [
          { memberId: userAId, role: 'admin' },
          { memberId: userBId, role: 'admin' },
        ],
      },
    },
  });
}

export async function promoteToAdmin(chatId: number, memberId: number) {
  await prisma.chatMember.update({
    where: { memberId_chatId: { memberId, chatId } },
    data: { role: 'admin' },
  });
}

/** Ids of everyone currently in the room, sorted ascending. */
export async function memberIdsOf(chatId: number) {
  const rows = await prisma.chatMember.findMany({
    where: { chatId },
    orderBy: { memberId: 'asc' },
    select: { memberId: true },
  });
  return rows.map((row) => row.memberId);
}
