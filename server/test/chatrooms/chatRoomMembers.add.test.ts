import { describe, expect, it } from 'vitest';
import { prisma } from '../../src/lib/prisma';
import { createUser, loginAs } from '../helpers/users';
import { createGroupRoom, memberIdsOf } from '../helpers/chatRooms';
import { makeFriends } from '../helpers/friends';

// Admin-only and group-only rules are in chatRoom.permissions.test.ts; the
// full list of bad member_ids bodies is in chatRoom.validator.unit.test.ts.
// Everyone who gets added has to be a friend of the admin who adds them.

describe('POST /chat/:chatid/member', () => {
  it('lets an admin add several users as regular members', async () => {
    const admin = await createUser('Alice');
    const bob = await createUser('Bob');
    const carol = await createUser('Carol');
    await makeFriends(admin.id, bob.id);
    await makeFriends(admin.id, carol.id);
    const room = await createGroupRoom(admin.id);
    const agent = await loginAs(admin);

    const res = await agent
      .post(`/chat/${room.id}/member`)
      .send({ member_ids: [bob.id, carol.id] });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      addedMembers: [
        {
          chatId: room.id,
          role: 'member',
          lastReadMessageId: null,
          member: { id: bob.id, name: 'Bob', avatarUrl: null },
        },
        {
          chatId: room.id,
          role: 'member',
          lastReadMessageId: null,
          member: { id: carol.id, name: 'Carol', avatarUrl: null },
        },
      ],
      alreadyMemberIds: [],
    });
    expect(await prisma.chatMember.count({ where: { chatId: room.id } })).toBe(3);
  });

  it('skips existing members without changing their role and ignores duplicate ids', async () => {
    const admin = await createUser('Alice');
    const bob = await createUser('Bob');
    const carol = await createUser('Carol');
    // Bob is already in the room but no longer a friend: skipped, not refused.
    await makeFriends(admin.id, carol.id);
    const room = await createGroupRoom(admin.id, [bob.id]);
    const agent = await loginAs(admin);

    const res = await agent
      .post(`/chat/${room.id}/member`)
      .send({ member_ids: [admin.id, bob.id, carol.id, carol.id] });

    expect(res.status).toBe(201);
    expect(res.body.addedMembers.map((m: { member: { id: number } }) => m.member.id)).toEqual([carol.id]);
    expect(res.body.alreadyMemberIds).toEqual([admin.id, bob.id]);

    const roles = await prisma.chatMember.findMany({
      where: { chatId: room.id },
      orderBy: { memberId: 'asc' },
      select: { memberId: true, role: true },
    });
    expect(roles).toEqual([
      { memberId: admin.id, role: 'admin' },
      { memberId: bob.id, role: 'member' },
      { memberId: carol.id, role: 'member' },
    ]);
  });

  it('returns 200 with nothing added when everyone is already a member', async () => {
    const admin = await createUser('Alice');
    const bob = await createUser('Bob');
    const room = await createGroupRoom(admin.id, [bob.id]);
    const agent = await loginAs(admin);

    const res = await agent.post(`/chat/${room.id}/member`).send({ member_ids: [bob.id] });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ addedMembers: [], alreadyMemberIds: [bob.id] });
    expect(await prisma.chatMember.count({ where: { chatId: room.id } })).toBe(2);
  });

  it('refuses the whole request when any one user is not a friend, and adds nobody', async () => {
    const admin = await createUser('Alice');
    const friend = await createUser('Bob');
    const stranger = await createUser('Carol');
    await makeFriends(admin.id, friend.id);
    const room = await createGroupRoom(admin.id);
    const agent = await loginAs(admin);

    const res = await agent
      .post(`/chat/${room.id}/member`)
      .send({ member_ids: [friend.id, stranger.id] });

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Only your friends can be added to a chat room' });
    expect(await memberIdsOf(room.id)).toEqual([admin.id]);
  });

  it('answers a user id that does not exist exactly like a stranger, so ids cannot be probed', async () => {
    const admin = await createUser('Alice');
    const friend = await createUser('Bob');
    const stranger = await createUser('Carol');
    await makeFriends(admin.id, friend.id);
    const room = await createGroupRoom(admin.id);
    const agent = await loginAs(admin);

    const forStranger = await agent
      .post(`/chat/${room.id}/member`)
      .send({ member_ids: [friend.id, stranger.id] });
    const forMissing = await agent
      .post(`/chat/${room.id}/member`)
      .send({ member_ids: [friend.id, 999_999] });

    expect(forMissing.status).toBe(forStranger.status);
    expect(forMissing.body).toEqual(forStranger.body);
    expect(forMissing.status).toBe(403);
    expect(await memberIdsOf(room.id)).toEqual([admin.id]);
  });

  it('only counts the admin\'s own friend-list row, not the other user\'s', async () => {
    const admin = await createUser('Alice');
    const other = await createUser('Bob');
    // Half a friendship: Bob's row names Alice, Alice's row does not name Bob.
    await prisma.friendListMember.create({ data: { userId: other.id, friendId: admin.id } });
    const room = await createGroupRoom(admin.id);
    const agent = await loginAs(admin);

    const res = await agent.post(`/chat/${room.id}/member`).send({ member_ids: [other.id] });

    expect(res.status).toBe(403);
    expect(await memberIdsOf(room.id)).toEqual([admin.id]);
  });

  it('rejects a malformed body with 400', async () => {
    const admin = await createUser('Alice');
    const room = await createGroupRoom(admin.id);
    const agent = await loginAs(admin);

    const res = await agent.post(`/chat/${room.id}/member`).send({ member_ids: [] });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "'member_ids' must be a non-empty array of user IDs" });
  });
});
