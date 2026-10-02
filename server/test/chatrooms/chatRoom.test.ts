import { describe, expect, it } from 'vitest';
import { prisma } from '../../src/lib/prisma';
import { createUser, loginAs } from '../helpers/users';
import { createDirectRoom, createGroupRoom, memberIdsOf } from '../helpers/chatRooms';
import { makeFriends } from '../helpers/friends';

// The room itself: create, list, read, rename, delete. Who is allowed to call
// what is in chatRoom.permissions.test.ts; input validation is in
// chatRoom.validator.unit.test.ts.

const NOT_FRIENDS = { error: 'Only your friends can be added to a chat room' };

describe('POST /chat', () => {
  it('creates a group room and persists its members', async () => {
    const user = await createUser('Alice');
    const member = await createUser('Bob');
    await makeFriends(user.id, member.id);
    const agent = await loginAs(user);

    const res = await agent.post('/chat').send({
      type: 'group',
      member_ids: [member.id],
      name: 'Project chat',
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ type: 'group', name: 'Project chat', avatarUrl: null });
    // Each entry is exactly this: the user is only under `member`, with no separate `memberId`.
    const members = [...res.body.members].sort((a, b) => a.member.id - b.member.id);
    expect(members).toEqual([
      {
        chatId: res.body.id,
        role: 'admin',
        lastReadMessageId: null,
        member: { id: user.id, name: 'Alice', avatarUrl: null },
      },
      {
        chatId: res.body.id,
        role: 'member',
        lastReadMessageId: null,
        member: { id: member.id, name: 'Bob', avatarUrl: null },
      },
    ]);
    expect(await prisma.chatRoom.count()).toBe(1);
    expect(await prisma.chatMember.count()).toBe(2);
  });

  it('creates a group room with nobody but its creator, which needs no friends', async () => {
    const user = await createUser('Alice');
    const agent = await loginAs(user);

    const res = await agent.post('/chat').send({ type: 'group', name: 'Notes to self' });

    expect(res.status).toBe(201);
    expect(await memberIdsOf(res.body.id)).toEqual([user.id]);
  });

  it('creates and reuses a direct room between two friends', async () => {
    const user = await createUser('Alice');
    const otherUser = await createUser('Bob');
    await makeFriends(user.id, otherUser.id);
    const agent = await loginAs(user);
    const body = { type: 'direct', member_ids: [otherUser.id] };

    const first = await agent.post('/chat').send(body);
    const second = await agent.post('/chat').send(body);

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.id).toBe(first.body.id);
    expect(await prisma.chatRoom.count()).toBe(1);
    expect(await prisma.chatMember.count()).toBe(2);
  });

  it('refuses a direct room with someone who is not a friend, and creates nothing', async () => {
    const user = await createUser('Alice');
    const stranger = await createUser('Bob');
    const agent = await loginAs(user);

    const res = await agent.post('/chat').send({ type: 'direct', member_ids: [stranger.id] });

    expect(res.status).toBe(403);
    expect(res.body).toEqual(NOT_FRIENDS);
    expect(await prisma.chatRoom.count()).toBe(0);
    expect(await prisma.chatMember.count()).toBe(0);
  });

  it('refuses the whole group room when any one invitee is not a friend', async () => {
    const user = await createUser('Alice');
    const friend = await createUser('Bob');
    const stranger = await createUser('Carol');
    await makeFriends(user.id, friend.id);
    const agent = await loginAs(user);

    const res = await agent.post('/chat').send({ type: 'group', member_ids: [friend.id, stranger.id] });

    expect(res.status).toBe(403);
    expect(res.body).toEqual(NOT_FRIENDS);
    expect(await prisma.chatRoom.count()).toBe(0);
    expect(await prisma.chatMember.count()).toBe(0);
  });

  it('answers a user id that does not exist exactly like a stranger, so ids cannot be probed', async () => {
    const user = await createUser('Alice');
    const stranger = await createUser('Bob');
    const agent = await loginAs(user);

    const forStranger = await agent.post('/chat').send({ type: 'group', member_ids: [stranger.id] });
    const forMissing = await agent.post('/chat').send({ type: 'group', member_ids: [999_999] });

    expect(forMissing.status).toBe(forStranger.status);
    expect(forMissing.body).toEqual(forStranger.body);
    expect(forMissing.status).toBe(403);
    expect(await prisma.chatRoom.count()).toBe(0);
  });

  it('only counts the requester\'s own friend-list row as a friendship', async () => {
    const user = await createUser('Alice');
    const other = await createUser('Bob');
    // Half a friendship: Bob's row names Alice, Alice's row does not name Bob.
    await prisma.friendListMember.create({ data: { userId: other.id, friendId: user.id } });
    const agent = await loginAs(user);

    const res = await agent.post('/chat').send({ type: 'direct', member_ids: [other.id] });

    expect(res.status).toBe(403);
    expect(await prisma.chatRoom.count()).toBe(0);
  });

  it('after unfriending: refuses to start a chat again, but the existing direct room keeps working', async () => {
    const user = await createUser('Alice');
    const former = await createUser('Bob');
    const room = await createDirectRoom(user.id, former.id);
    const agent = await loginAs(user);

    const res = await agent.post('/chat').send({ type: 'direct', member_ids: [former.id] });

    // The check comes before the lookup of an existing room, so the room is not handed out here...
    expect(res.status).toBe(403);
    expect(res.body).toEqual(NOT_FRIENDS);
    // ...but it is still there, still listed, and still usable.
    expect(await memberIdsOf(room.id)).toEqual([user.id, former.id]);
    const list = await agent.get('/chat');
    expect(list.body.chatRooms.map((r: { id: number }) => r.id)).toEqual([room.id]);
    const sent = await agent.post(`/chat/${room.id}/message`).send({ content: 'still here' });
    expect(sent.status).toBe(201);
  });
});

describe('GET /chat', () => {
  it('lists direct and group rooms, most recent activity first', async () => {
    const user = await createUser('Alice');
    const otherUser = await createUser('Bob');
    const agent = await loginAs(user);
    const directRoom = await prisma.chatRoom.create({
      data: {
        type: 'direct',
        createdAt: new Date('2026-09-13T11:00:00.000Z'),
        members: {
          create: [
            { memberId: user.id, role: 'admin' },
            { memberId: otherUser.id, role: 'admin' },
          ],
        },
      },
    });
    // Created after the direct room, but its only activity is that creation...
    const groupRoom = await createGroupRoom(user.id, [], 'Project chat');
    await prisma.chatRoom.update({
      where: { id: groupRoom.id },
      data: { createdAt: new Date('2026-09-13T12:00:00.000Z') },
    });
    // ...while the direct room has a later message, so it must come first.
    await prisma.message.create({
      data: {
        chatId: directRoom.id,
        senderId: otherUser.id,
        content: 'Hello',
        createdAt: new Date('2026-09-13T13:00:00.000Z'),
      },
    });

    const res = await agent.get('/chat');

    expect(res.status).toBe(200);
    expect(res.body.chatRooms.map((room: { id: number }) => room.id)).toEqual([
      directRoom.id,
      groupRoom.id,
    ]);
    expect(res.body.chatRooms[0]).toMatchObject({
      name: 'Bob',
      lastMessage: { content: 'Hello' },
    });
  });
});

describe('GET /chat/:chatid', () => {
  it('loads a room the user belongs to and includes their role', async () => {
    const user = await createUser('Alice');
    const admin = await createUser('Bob');
    const room = await createGroupRoom(admin.id, [user.id]);
    const agent = await loginAs(user);

    const res = await agent.get(`/chat/${room.id}`);

    expect(res.status).toBe(200);
    expect(res.body.chatRoom).toMatchObject({
      id: room.id,
      type: 'group',
      name: 'Project chat',
      role: 'member',
    });
  });
});

describe('PATCH /chat/:chatid', () => {
  it('lets an admin rename a group room and change its avatar', async () => {
    const user = await createUser('Alice');
    const room = await createGroupRoom(user.id);
    const agent = await loginAs(user);

    const res = await agent
      .patch(`/chat/${room.id}`)
      .send({ name: 'Updated project chat', avatar_url: 'https://example.com/project.png' });

    expect(res.status).toBe(200);
    expect(res.body.chatRoom).toMatchObject({
      id: room.id,
      name: 'Updated project chat',
      avatarUrl: 'https://example.com/project.png',
    });
    expect(await prisma.chatRoom.findUnique({ where: { id: room.id } })).toMatchObject({
      name: 'Updated project chat',
      avatarUrl: 'https://example.com/project.png',
    });
  });
});

describe('DELETE /chat/:chatid', () => {
  it('lets an admin delete a group room together with its members and messages', async () => {
    const admin = await createUser('Alice');
    const member = await createUser('Bob');
    const room = await createGroupRoom(admin.id, [member.id]);
    await prisma.message.create({ data: { chatId: room.id, senderId: member.id, content: 'Hello' } });
    const agent = await loginAs(admin);

    const res = await agent.delete(`/chat/${room.id}`);

    expect(res.status).toBe(204);
    expect(await prisma.chatRoom.findUnique({ where: { id: room.id } })).toBeNull();
    expect(await prisma.chatMember.count({ where: { chatId: room.id } })).toBe(0);
    expect(await prisma.message.count({ where: { chatId: room.id } })).toBe(0);
  });
});
