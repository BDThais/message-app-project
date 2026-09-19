import { ChatMemberRole } from '../generated/prisma/client';
import { prisma } from '../lib/prisma';

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
 * - POST /chatrooms/:chatid/members — called (via
 *   addMembersToExistingChatRoom below) with the main `prisma` client,
 *   using the default role: 'member'.
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

/**
 * Adds users to a room that already exists (POST /chatrooms/:chatid/members).
 *
 * Users who are already members are left completely untouched - in
 * particular an existing admin is never downgraded to 'member' - and are
 * reported back in `alreadyMemberIds` instead of failing the request.
 * Everyone else joins with the default role: 'member'.
 *
 * The insert is a single statement, so if any ID doesn't refer to a real
 * user the foreign-key error (see isForeignKeyConstraintError) is thrown
 * and *nobody* from this request is added.
 */
export async function addMembersToExistingChatRoom(chatId: number, memberIds: number[]) {
  const existingMembers = await prisma.chatMember.findMany({
    where: { chatId, memberId: { in: memberIds } },
    select: { memberId: true },
    orderBy: { memberId: 'asc' },
  });
  const alreadyMemberIds = existingMembers.map((row) => row.memberId);
  const newMemberIds = memberIds.filter((id) => !alreadyMemberIds.includes(id));

  await addChatRoomMembers(prisma, chatId, newMemberIds);

  const addedMembers = await prisma.chatMember.findMany({
    where: { chatId, memberId: { in: newMemberIds } },
    include: { member: { select: { id: true, name: true, avatarUrl: true } } },
    orderBy: { memberId: 'asc' },
  });

  return { addedMembers, alreadyMemberIds };
}
