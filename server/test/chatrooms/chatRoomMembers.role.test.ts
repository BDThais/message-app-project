import { describe, expect, it } from 'vitest';
import { prisma } from '../../src/lib/prisma';
import { createUser, loginAs } from '../helpers/users';
import { createGroupRoom } from '../helpers/chatRooms';

// Admin-only and group-only rules are in chatRoom.permissions.test.ts.

describe('PATCH /chat/:chatid/member/:userid', () => {
  it('changes a member\'s role and returns the updated member', async () => {
    const admin = await createUser('Alice');
    const bob = await createUser('Bob');
    const room = await createGroupRoom(admin.id, [bob.id]);
    const agent = await loginAs(admin);

    const res = await agent.patch(`/chat/${room.id}/member/${bob.id}`).send({ role: 'admin' });

    expect(res.status).toBe(200);
    // The user is only under `member`, with no separate `memberId`.
    expect(res.body).toEqual({
      member: {
        chatId: room.id,
        role: 'admin',
        lastReadMessageId: null,
        member: { id: bob.id, name: 'Bob', avatarUrl: null },
      },
    });
    expect(
      await prisma.chatMember.findUnique({
        where: { memberId_chatId: { memberId: bob.id, chatId: room.id } },
      })
    ).toMatchObject({ role: 'admin' });
  });
});
