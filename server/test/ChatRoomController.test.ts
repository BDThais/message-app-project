import { describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../src/app';
import { hashPassword } from '../src/lib/passwordHash';
import { prisma } from '../src/lib/prisma';

type TestUser = Awaited<ReturnType<typeof createUser>>;

const password = 'Str0ng!Pass';

async function createUser(name: string, email: string, tel: string): Promise<{
  id: number;
  name: string;
  email: string;
  tel: string;
  passwordHash: string;
}> {
  return prisma.user.create({
    data: { name, email, tel, passwordHash: await hashPassword(password) },
  });
}

async function loginAs(user: TestUser) {
  const agent = request.agent(app);
  const response = await agent.post('/account/login').send({ email: user.email, password });
  expect(response.status).toBe(200);
  return agent;
}

async function createGroupRoom(adminId: number, memberIds: number[] = [], name = 'Project chat') {
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

describe('chat room endpoints', () => {
  it('creates a group room and persists its members', async () => {
    const user = await createUser('Alice', 'alice@example.com', '+14155552671');
    const member = await createUser('Bob', 'bob@example.com', '+14155552672');
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
    const user = await createUser('Alice', 'alice@example.com', '+14155552671');
    const otherUser = await createUser('Bob', 'bob@example.com', '+14155552672');
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

  it('lists direct and group rooms by recent activity', async () => {
    const user = await createUser('Alice', 'alice@example.com', '+14155552671');
    const otherUser = await createUser('Bob', 'bob@example.com', '+14155552672');
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
    const groupRoom = await createGroupRoom(user.id, [], 'Project chat');
    await prisma.message.create({
      data: {
        chatId: directRoom.id,
        senderId: otherUser.id,
        content: 'Hello',
        createdAt: new Date('2027-09-13T13:00:00.000Z'),
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

  it('loads a member room and includes the requester role', async () => {
    const user = await createUser('Alice', 'alice@example.com', '+14155552671');
    const admin = await createUser('Bob', 'bob@example.com', '+14155552672');
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

  it('rejects an unauthenticated chat-room request', async () => {
    const res = await request(app).get('/chatrooms');

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Unauthorized Access' });
  });

  it('updates a group room for an authenticated admin', async () => {
    const user = await createUser('Alice', 'alice@example.com', '+14155552671');
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

  it('rejects a member from updating a group room and lets an admin delete it', async () => {
    const member = await createUser('Alice', 'alice@example.com', '+14155552671');
    const admin = await createUser('Bob', 'bob@example.com', '+14155552672');
    const room = await createGroupRoom(admin.id, [member.id]);
    const memberAgent = await loginAs(member);

    const forbidden = await memberAgent
      .patch(`/chatrooms/${room.id}`)
      .send({ name: 'Not allowed' });

    expect(forbidden.status).toBe(403);
    expect(forbidden.body).toEqual({ message: 'Admin role required for this action' });

    const adminAgent = await loginAs(admin);
    const deleted = await adminAgent.delete(`/chatrooms/${room.id}`);

    expect(deleted.status).toBe(204);
    expect(await prisma.chatRoom.findUnique({ where: { id: room.id } })).toBeNull();
    expect(await prisma.chatMember.count({ where: { chatId: room.id } })).toBe(0);
  });
});
