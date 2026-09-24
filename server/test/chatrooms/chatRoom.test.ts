import { describe, expect, it } from 'vitest';
import { prisma } from '../../src/lib/prisma';
import { createUser, loginAs } from '../helpers/users';
import { createGroupRoom } from '../helpers/chatRooms';

// The room itself: create, list, read, rename, delete. Who is allowed to call
// what is in chatRoom.permissions.test.ts; input validation is in
// chatRoom.validator.unit.test.ts.

describe('POST /chatrooms', () => {
  it('creates a group room and persists its members', async () => {
    const user = await createUser('Alice');
    const member = await createUser('Bob');
    const agent = await loginAs(user);

    const res = await agent.post('/chatrooms').send({
      type: 'group',
      member_ids: [member.id],
      name: 'Project chat',
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      type: 'group',
      name: 'Project chat',
      avatarUrl: null,
      members: expect.arrayContaining([
        expect.objectContaining({ memberId: user.id, role: 'admin' }),
        expect.objectContaining({ memberId: member.id, role: 'member' }),
      ]),
    });
    expect(await prisma.chatRoom.count()).toBe(1);
    expect(await prisma.chatMember.count()).toBe(2);
  });

  it('creates and reuses a direct room between two users', async () => {
    const user = await createUser('Alice');
    const otherUser = await createUser('Bob');
    const agent = await loginAs(user);
    const body = { type: 'direct', member_ids: [otherUser.id] };

    const first = await agent.post('/chatrooms').send(body);
    const second = await agent.post('/chatrooms').send(body);

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.id).toBe(first.body.id);
    expect(await prisma.chatRoom.count()).toBe(1);
    expect(await prisma.chatMember.count()).toBe(2);
  });

  it('rejects an unknown user id and leaves no half-created room behind', async () => {
    const user = await createUser('Alice');
    const agent = await loginAs(user);

    const res = await agent.post('/chatrooms').send({ type: 'group', member_ids: [999_999] });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'one or more member_ids do not refer to an existing user' });
    expect(await prisma.chatRoom.count()).toBe(0);
    expect(await prisma.chatMember.count()).toBe(0);
  });
});

describe('GET /chatrooms', () => {
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

    const res = await agent.get('/chatrooms');

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

describe('GET /chatrooms/:chatid', () => {
  it('loads a room the user belongs to and includes their role', async () => {
    const user = await createUser('Alice');
    const admin = await createUser('Bob');
    const room = await createGroupRoom(admin.id, [user.id]);
    const agent = await loginAs(user);

    const res = await agent.get(`/chatrooms/${room.id}`);

    expect(res.status).toBe(200);
    expect(res.body.chatRoom).toMatchObject({
      id: room.id,
      type: 'group',
      name: 'Project chat',
      role: 'member',
    });
  });
});

describe('PATCH /chatrooms/:chatid', () => {
  it('lets an admin rename a group room and change its avatar', async () => {
    const user = await createUser('Alice');
    const room = await createGroupRoom(user.id);
    const agent = await loginAs(user);

    const res = await agent
      .patch(`/chatrooms/${room.id}`)
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

describe('DELETE /chatrooms/:chatid', () => {
  it('lets an admin delete a group room together with its members and messages', async () => {
    const admin = await createUser('Alice');
    const member = await createUser('Bob');
    const room = await createGroupRoom(admin.id, [member.id]);
    await prisma.message.create({ data: { chatId: room.id, senderId: member.id, content: 'Hello' } });
    const agent = await loginAs(admin);

    const res = await agent.delete(`/chatrooms/${room.id}`);

    expect(res.status).toBe(204);
    expect(await prisma.chatRoom.findUnique({ where: { id: room.id } })).toBeNull();
    expect(await prisma.chatMember.count({ where: { chatId: room.id } })).toBe(0);
    expect(await prisma.message.count({ where: { chatId: room.id } })).toBe(0);
  });
});
