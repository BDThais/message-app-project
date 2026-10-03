import { describe, expect, it } from 'vitest';
import { createUser, loginAs } from '../helpers/users';
import { createDirectRoom, createGroupRoom, promoteToAdmin } from '../helpers/chatRooms';

// The session/membership guard on this route is covered once for every route
// in chatRoom.permissions.test.ts.

describe('GET /chat/:chatid/member', () => {
  it('lists the room\'s members, admins first and then by name, without anyone from another room', async () => {
    // Created out of name order on purpose, so the order can't be the id order.
    const zoe = await createUser('Zoe');
    const carl = await createUser('Carl');
    const mia = await createUser('Mia');
    const bea = await createUser('bea');
    const outsider = await createUser('Aaron');
    const room = await createGroupRoom(zoe.id, [carl.id, mia.id, bea.id]);
    await promoteToAdmin(room.id, mia.id);
    await createGroupRoom(outsider.id, [zoe.id], 'Other chat');
    const agent = await loginAs(carl);

    const res = await agent.get(`/chat/${room.id}/member`);

    expect(res.status).toBe(200);
    // Same shape as PATCH /chat/:chatid/member/:userid: the user only under
    // `member`. 'bea' sorts before 'Carl' because the name order ignores case.
    expect(res.body).toEqual({
      members: [
        { chatId: room.id, role: 'admin', lastReadMessageId: null, member: { id: mia.id, name: 'Mia', avatarUrl: null } },
        { chatId: room.id, role: 'admin', lastReadMessageId: null, member: { id: zoe.id, name: 'Zoe', avatarUrl: null } },
        { chatId: room.id, role: 'member', lastReadMessageId: null, member: { id: bea.id, name: 'bea', avatarUrl: null } },
        { chatId: room.id, role: 'member', lastReadMessageId: null, member: { id: carl.id, name: 'Carl', avatarUrl: null } },
      ],
    });
  });

  it('lets either member of a direct room list both members', async () => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');
    const room = await createDirectRoom(alice.id, bob.id);
    const agent = await loginAs(bob);

    const res = await agent.get(`/chat/${room.id}/member`);

    expect(res.status).toBe(200);
    expect(
      res.body.members.map((m: { role: string; member: { name: string } }) => [m.member.name, m.role])
    ).toEqual([
      ['Alice', 'admin'],
      ['Bob', 'admin'],
    ]);
  });

  it('does not list the members of a room the user is not in', async () => {
    const alice = await createUser('Alice');
    const stranger = await createUser('Bob');
    const room = await createGroupRoom(alice.id);
    const agent = await loginAs(stranger);

    const res = await agent.get(`/chat/${room.id}/member`);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Chat room not found' });
  });
});
