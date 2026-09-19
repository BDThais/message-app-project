import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import app from '../src/app';
import { hashPassword } from '../src/lib/passwordHash';
import { prisma } from '../src/lib/prisma';

// loginAs() logs in through the real /account/login route, whose limiter allows
// only 10 attempts per 15 minutes per IP (in memory, shared by the whole file).
// This file logs in once per test, so it would start getting 429s after ~10
// tests. The limiter isn't what these tests are about, so replace it with a
// pass-through here.
vi.mock('../src/middlewares/RateLimiter', () => ({
  loginLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

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

describe('POST /chatrooms/:chatid/members', () => {
  it('lets an admin add several users as regular members', async () => {
    const admin = await createUser('Alice', 'alice@example.com', '+14155552671');
    const bob = await createUser('Bob', 'bob@example.com', '+14155552672');
    const carol = await createUser('Carol', 'carol@example.com', '+14155552673');
    const room = await createGroupRoom(admin.id);
    const agent = await loginAs(admin);

    const res = await agent
      .post(`/chatrooms/${room.id}/members`)
      .send({ member_ids: [bob.id, carol.id] });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      addedMembers: [
        {
          memberId: bob.id,
          chatId: room.id,
          role: 'member',
          lastReadMessageId: null,
          member: { id: bob.id, name: 'Bob', avatarUrl: null },
        },
        {
          memberId: carol.id,
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
    const admin = await createUser('Alice', 'alice@example.com', '+14155552671');
    const bob = await createUser('Bob', 'bob@example.com', '+14155552672');
    const carol = await createUser('Carol', 'carol@example.com', '+14155552673');
    const room = await createGroupRoom(admin.id, [bob.id]);
    const agent = await loginAs(admin);

    const res = await agent
      .post(`/chatrooms/${room.id}/members`)
      .send({ member_ids: [admin.id, bob.id, carol.id, carol.id] });

    expect(res.status).toBe(201);
    expect(res.body.addedMembers.map((m: { memberId: number }) => m.memberId)).toEqual([carol.id]);
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
    const admin = await createUser('Alice', 'alice@example.com', '+14155552671');
    const bob = await createUser('Bob', 'bob@example.com', '+14155552672');
    const room = await createGroupRoom(admin.id, [bob.id]);
    const agent = await loginAs(admin);

    const res = await agent.post(`/chatrooms/${room.id}/members`).send({ member_ids: [bob.id] });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ addedMembers: [], alreadyMemberIds: [bob.id] });
    expect(await prisma.chatMember.count({ where: { chatId: room.id } })).toBe(2);
  });

  it('rejects a regular member and adds nobody', async () => {
    const admin = await createUser('Alice', 'alice@example.com', '+14155552671');
    const member = await createUser('Bob', 'bob@example.com', '+14155552672');
    const outsider = await createUser('Carol', 'carol@example.com', '+14155552673');
    const room = await createGroupRoom(admin.id, [member.id]);
    const agent = await loginAs(member);

    const res = await agent
      .post(`/chatrooms/${room.id}/members`)
      .send({ member_ids: [outsider.id] });

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ message: 'Admin role required for this action' });
    expect(await prisma.chatMember.count({ where: { chatId: room.id } })).toBe(2);
  });

  it('rejects adding members to a direct room even though both users are admins', async () => {
    const alice = await createUser('Alice', 'alice@example.com', '+14155552671');
    const bob = await createUser('Bob', 'bob@example.com', '+14155552672');
    const carol = await createUser('Carol', 'carol@example.com', '+14155552673');
    const directRoom = await prisma.chatRoom.create({
      data: {
        type: 'direct',
        members: {
          create: [
            { memberId: alice.id, role: 'admin' },
            { memberId: bob.id, role: 'admin' },
          ],
        },
      },
    });
    const agent = await loginAs(alice);

    const res = await agent
      .post(`/chatrooms/${directRoom.id}/members`)
      .send({ member_ids: [carol.id] });

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ message: 'Not available for direct chat rooms' });
    expect(await prisma.chatMember.count({ where: { chatId: directRoom.id } })).toBe(2);
  });

  it("returns 404 when the requester isn't a member of the room", async () => {
    const admin = await createUser('Alice', 'alice@example.com', '+14155552671');
    const stranger = await createUser('Bob', 'bob@example.com', '+14155552672');
    const room = await createGroupRoom(admin.id);
    const agent = await loginAs(stranger);

    const res = await agent
      .post(`/chatrooms/${room.id}/members`)
      .send({ member_ids: [stranger.id] });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Chat room not found' });
    expect(await prisma.chatMember.count({ where: { chatId: room.id } })).toBe(1);
  });

  it('rejects an unauthenticated request', async () => {
    const res = await request(app).post('/chatrooms/1/members').send({ member_ids: [2] });

    expect(res.status).toBe(401);
  });

  it.each([
    ['a missing member_ids', {}],
    ['an empty member_ids array', { member_ids: [] }],
    ['a non-array member_ids', { member_ids: 2 }],
    ['a non-integer id', { member_ids: [1.5] }],
    ['a string id', { member_ids: ['2'] }],
    ['a zero id', { member_ids: [0] }],
    ['a negative id', { member_ids: [-3] }],
    ['an id larger than a Postgres integer', { member_ids: [2_147_483_648] }],
  ])('rejects %s with 400', async (_label, body) => {
    const admin = await createUser('Alice', 'alice@example.com', '+14155552671');
    const room = await createGroupRoom(admin.id);
    const agent = await loginAs(admin);

    const res = await agent.post(`/chatrooms/${room.id}/members`).send(body);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ message: "'member_ids' must be a non-empty array of user IDs" });
  });

  it('rejects a request with no body', async () => {
    const admin = await createUser('Alice', 'alice@example.com', '+14155552671');
    const room = await createGroupRoom(admin.id);
    const agent = await loginAs(admin);

    const res = await agent.post(`/chatrooms/${room.id}/members`);

    expect(res.status).toBe(400);
  });

  it('rejects unknown user ids and does not add the valid ones from the same request', async () => {
    const admin = await createUser('Alice', 'alice@example.com', '+14155552671');
    const bob = await createUser('Bob', 'bob@example.com', '+14155552672');
    const room = await createGroupRoom(admin.id);
    const agent = await loginAs(admin);

    const res = await agent
      .post(`/chatrooms/${room.id}/members`)
      .send({ member_ids: [bob.id, 999_999] });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      message: 'one or more member_ids do not refer to an existing user',
    });
    expect(await prisma.chatMember.count({ where: { chatId: room.id } })).toBe(1);
  });
});
