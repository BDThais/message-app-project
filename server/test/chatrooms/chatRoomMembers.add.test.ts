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

  // What was said before someone joined counts as read for them. The marker
  // is the newest message that is not deleted; a deleted one above it never
  // counted as unread anyway.
  it('starts a new member with the existing messages counted as read, and leaves an existing member\'s marker alone', async () => {
    const admin = await createUser('Alice');
    const bob = await createUser('Bob');
    const dave = await createUser('Dave');
    await makeFriends(admin.id, bob.id);
    const room = await createGroupRoom(admin.id, [dave.id]);
    const first = await prisma.message.create({ data: { chatId: room.id, senderId: admin.id, content: 'First' } });
    const second = await prisma.message.create({ data: { chatId: room.id, senderId: admin.id, content: 'Second' } });
    await prisma.message.create({
      data: { chatId: room.id, senderId: admin.id, content: '', deletedAt: new Date() },
    });
    await prisma.chatMember.update({
      where: { memberId_chatId: { memberId: dave.id, chatId: room.id } },
      data: { lastReadMessageId: first.id },
    });
    const adminAgent = await loginAs(admin);

    const res = await adminAgent.post(`/chat/${room.id}/member`).send({ member_ids: [bob.id, dave.id] });

    expect(res.status).toBe(201);
    expect(res.body.addedMembers).toEqual([
      expect.objectContaining({ lastReadMessageId: second.id, member: expect.objectContaining({ id: bob.id }) }),
    ]);
    const bobAgent = await loginAs(bob);
    const daveAgent = await loginAs(dave);
    // The summary of this room from the list and from the single-room route.
    const summariesFor = async (agent: typeof bobAgent) => [
      (await agent.get('/chat')).body.chatRooms.find((r: { id: number }) => r.id === room.id),
      (await agent.get(`/chat/${room.id}`)).body.chatRoom,
    ];
    for (const summary of await summariesFor(bobAgent)) {
      expect(summary).toMatchObject({ unreadCount: 0, lastMessage: { content: 'Second' } });
    }
    // Dave never read the second message, and being named in the request changed nothing for him.
    for (const summary of await summariesFor(daveAgent)) {
      expect(summary).toMatchObject({ unreadCount: 1 });
    }

    // Only what is sent after they joined is unread for the new member.
    await adminAgent.post(`/chat/${room.id}/message`).send({ content: 'Third' });
    const after = await bobAgent.get(`/chat/${room.id}`);
    expect(after.body.chatRoom.unreadCount).toBe(1);
  });

  it('starts a new member without a marker when the room has no message that is still there', async () => {
    const admin = await createUser('Alice');
    const bob = await createUser('Bob');
    await makeFriends(admin.id, bob.id);
    const room = await createGroupRoom(admin.id);
    await prisma.message.create({
      data: { chatId: room.id, senderId: admin.id, content: '', deletedAt: new Date() },
    });

    const res = await (await loginAs(admin)).post(`/chat/${room.id}/member`).send({ member_ids: [bob.id] });

    expect(res.status).toBe(201);
    expect(res.body.addedMembers[0].lastReadMessageId).toBeNull();
    expect((await (await loginAs(bob)).get(`/chat/${room.id}`)).body.chatRoom.unreadCount).toBe(0);
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
