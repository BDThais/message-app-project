import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import app from '../src/app';
import { hashPassword } from '../src/lib/passwordHash';
import { prisma } from '../src/lib/prisma';
import { purgeExpiredEmptyChatRooms } from '../src/modules/chatrooms/chatRoomCleanup.service';

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

async function createDirectRoom(userAId: number, userBId: number) {
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

async function promoteToAdmin(chatId: number, memberId: number) {
  await prisma.chatMember.update({
    where: { memberId_chatId: { memberId, chatId } },
    data: { role: 'admin' },
  });
}

async function memberIdsOf(chatId: number) {
  const rows = await prisma.chatMember.findMany({
    where: { chatId },
    orderBy: { memberId: 'asc' },
    select: { memberId: true },
  });
  return rows.map((row) => row.memberId);
}

describe('DELETE /chatrooms/:chatid/members/:userid', () => {
  it('lets an admin remove a regular member', async () => {
    const admin = await createUser('Alice', 'alice@example.com', '+14155552671');
    const bob = await createUser('Bob', 'bob@example.com', '+14155552672');
    const carol = await createUser('Carol', 'carol@example.com', '+14155552673');
    const room = await createGroupRoom(admin.id, [bob.id, carol.id]);
    const agent = await loginAs(admin);

    const res = await agent.delete(`/chatrooms/${room.id}/members/${bob.id}`);

    expect(res.status).toBe(204);
    expect(res.text).toBe('');
    expect(await memberIdsOf(room.id)).toEqual([admin.id, carol.id]);
  });

  it('lets a regular member leave the room', async () => {
    const admin = await createUser('Alice', 'alice@example.com', '+14155552671');
    const bob = await createUser('Bob', 'bob@example.com', '+14155552672');
    const room = await createGroupRoom(admin.id, [bob.id]);
    const agent = await loginAs(bob);

    const res = await agent.delete(`/chatrooms/${room.id}/members/${bob.id}`);

    expect(res.status).toBe(204);
    expect(await memberIdsOf(room.id)).toEqual([admin.id]);
    expect((await prisma.chatRoom.findUniqueOrThrow({ where: { id: room.id } })).emptiedAt).toBeNull();
  });

  it('rejects a regular member removing someone else and removes nobody', async () => {
    const admin = await createUser('Alice', 'alice@example.com', '+14155552671');
    const bob = await createUser('Bob', 'bob@example.com', '+14155552672');
    const carol = await createUser('Carol', 'carol@example.com', '+14155552673');
    const room = await createGroupRoom(admin.id, [bob.id, carol.id]);
    const agent = await loginAs(bob);

    const removeMember = await agent.delete(`/chatrooms/${room.id}/members/${carol.id}`);
    const removeAdmin = await agent.delete(`/chatrooms/${room.id}/members/${admin.id}`);

    for (const res of [removeMember, removeAdmin]) {
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ message: 'Admin role required for this action' });
    }
    expect(await memberIdsOf(room.id)).toEqual([admin.id, bob.id, carol.id]);
  });

  it('lets an admin remove another admin while a second admin remains', async () => {
    const alice = await createUser('Alice', 'alice@example.com', '+14155552671');
    const bob = await createUser('Bob', 'bob@example.com', '+14155552672');
    const room = await createGroupRoom(alice.id, [bob.id]);
    await promoteToAdmin(room.id, bob.id);
    const agent = await loginAs(alice);

    const res = await agent.delete(`/chatrooms/${room.id}/members/${bob.id}`);

    expect(res.status).toBe(204);
    expect(await memberIdsOf(room.id)).toEqual([alice.id]);
  });

  it('lets one of several admins leave', async () => {
    const alice = await createUser('Alice', 'alice@example.com', '+14155552671');
    const bob = await createUser('Bob', 'bob@example.com', '+14155552672');
    const carol = await createUser('Carol', 'carol@example.com', '+14155552673');
    const room = await createGroupRoom(alice.id, [bob.id, carol.id]);
    await promoteToAdmin(room.id, bob.id);
    const agent = await loginAs(alice);

    const res = await agent.delete(`/chatrooms/${room.id}/members/${alice.id}`);

    expect(res.status).toBe(204);
    expect(await memberIdsOf(room.id)).toEqual([bob.id, carol.id]);
  });

  it('rejects the only admin leaving while other members remain', async () => {
    const admin = await createUser('Alice', 'alice@example.com', '+14155552671');
    const bob = await createUser('Bob', 'bob@example.com', '+14155552672');
    const room = await createGroupRoom(admin.id, [bob.id]);
    const agent = await loginAs(admin);

    const res = await agent.delete(`/chatrooms/${room.id}/members/${admin.id}`);

    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      message:
        'The only admin cannot be removed while other members remain; promote another member to admin first',
    });
    expect(await memberIdsOf(room.id)).toEqual([admin.id, bob.id]);
  });

  it('blocks the last admin from leaving after the other admin has left', async () => {
    const alice = await createUser('Alice', 'alice@example.com', '+14155552671');
    const bob = await createUser('Bob', 'bob@example.com', '+14155552672');
    const carol = await createUser('Carol', 'carol@example.com', '+14155552673');
    const room = await createGroupRoom(alice.id, [bob.id, carol.id]);
    await promoteToAdmin(room.id, bob.id);
    const aliceAgent = await loginAs(alice);
    const bobAgent = await loginAs(bob);

    const aliceLeaves = await aliceAgent.delete(`/chatrooms/${room.id}/members/${alice.id}`);
    const bobLeaves = await bobAgent.delete(`/chatrooms/${room.id}/members/${bob.id}`);

    expect(aliceLeaves.status).toBe(204);
    expect(bobLeaves.status).toBe(409);
    expect(await memberIdsOf(room.id)).toEqual([bob.id, carol.id]);
  });

  it('lets the only admin leave once they have removed every other member', async () => {
    const admin = await createUser('Alice', 'alice@example.com', '+14155552671');
    const bob = await createUser('Bob', 'bob@example.com', '+14155552672');
    const carol = await createUser('Carol', 'carol@example.com', '+14155552673');
    const room = await createGroupRoom(admin.id, [bob.id, carol.id]);
    const agent = await loginAs(admin);

    expect((await agent.delete(`/chatrooms/${room.id}/members/${admin.id}`)).status).toBe(409);
    expect((await agent.delete(`/chatrooms/${room.id}/members/${bob.id}`)).status).toBe(204);
    expect((await agent.delete(`/chatrooms/${room.id}/members/${carol.id}`)).status).toBe(204);

    const leaves = await agent.delete(`/chatrooms/${room.id}/members/${admin.id}`);

    expect(leaves.status).toBe(204);
    expect(await memberIdsOf(room.id)).toEqual([]);
  });

  it('lets the last member leave, keeping the empty room and its messages for later cleanup', async () => {
    const admin = await createUser('Alice', 'alice@example.com', '+14155552671');
    const room = await createGroupRoom(admin.id);
    await prisma.message.create({
      data: { chatId: room.id, senderId: admin.id, content: 'Hello' },
    });
    const agent = await loginAs(admin);

    const res = await agent.delete(`/chatrooms/${room.id}/members/${admin.id}`);

    expect(res.status).toBe(204);
    expect(await memberIdsOf(room.id)).toEqual([]);
    expect(await prisma.chatRoom.findUnique({ where: { id: room.id } })).not.toBeNull();
    expect(await prisma.message.count({ where: { chatId: room.id } })).toBe(1);
  });

  it('marks the room as empty when the last member leaves, and the cleanup deletes it after the retention period', async () => {
    const admin = await createUser('Alice', 'alice@example.com', '+14155552671');
    const room = await createGroupRoom(admin.id);
    await prisma.message.create({
      data: { chatId: room.id, senderId: admin.id, content: 'Hello' },
    });
    const agent = await loginAs(admin);
    const retentionMs = 7 * 24 * 60 * 60 * 1000;
    const leftAt = Date.now();

    expect((await agent.delete(`/chatrooms/${room.id}/members/${admin.id}`)).status).toBe(204);

    const emptied = await prisma.chatRoom.findUniqueOrThrow({ where: { id: room.id } });
    expect(emptied.emptiedAt).not.toBeNull();
    expect(emptied.emptiedAt!.getTime()).toBeGreaterThanOrEqual(leftAt - 1000);

    // Just before the retention period is over: still there.
    const early = await purgeExpiredEmptyChatRooms(retentionMs, new Date(leftAt + retentionMs - 60_000));
    expect(early.deleted).toBe(0);
    expect(await prisma.chatRoom.findUnique({ where: { id: room.id } })).not.toBeNull();

    // After it: the room and its messages are gone.
    const late = await purgeExpiredEmptyChatRooms(retentionMs, new Date(leftAt + retentionMs + 60_000));
    expect(late.deleted).toBe(1);
    expect(await prisma.chatRoom.findUnique({ where: { id: room.id } })).toBeNull();
    expect(await prisma.message.count({ where: { chatId: room.id } })).toBe(0);
  });

  it('never lets two simultaneous exits leave a room with members but no admin', async () => {
    const alice = await createUser('Alice', 'alice@example.com', '+14155552671');
    const bob = await createUser('Bob', 'bob@example.com', '+14155552672');
    const carol = await createUser('Carol', 'carol@example.com', '+14155552673');
    const room = await createGroupRoom(alice.id, [bob.id, carol.id]);
    await promoteToAdmin(room.id, bob.id);
    const [aliceAgent, bobAgent] = await Promise.all([loginAs(alice), loginAs(bob)]);

    const [aliceLeaves, bobLeaves] = await Promise.all([
      aliceAgent.delete(`/chatrooms/${room.id}/members/${alice.id}`),
      bobAgent.delete(`/chatrooms/${room.id}/members/${bob.id}`),
    ]);

    expect([aliceLeaves.status, bobLeaves.status].sort()).toEqual([204, 409]);
    expect(await prisma.chatMember.count({ where: { chatId: room.id } })).toBe(2);
    expect(await prisma.chatMember.count({ where: { chatId: room.id, role: 'admin' } })).toBe(1);
  });

  it('returns 404 when the target is not a member of the room', async () => {
    const admin = await createUser('Alice', 'alice@example.com', '+14155552671');
    const outsider = await createUser('Bob', 'bob@example.com', '+14155552672');
    const room = await createGroupRoom(admin.id);
    const agent = await loginAs(admin);

    const notAMember = await agent.delete(`/chatrooms/${room.id}/members/${outsider.id}`);
    const noSuchUser = await agent.delete(`/chatrooms/${room.id}/members/999999`);

    for (const res of [notAMember, noSuchUser]) {
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ message: 'Member not found in this chat room' });
    }
    expect(await memberIdsOf(room.id)).toEqual([admin.id]);
  });

  it("returns 404 when the requester isn't a member of the room", async () => {
    const admin = await createUser('Alice', 'alice@example.com', '+14155552671');
    const stranger = await createUser('Bob', 'bob@example.com', '+14155552672');
    const room = await createGroupRoom(admin.id);
    const agent = await loginAs(stranger);

    const res = await agent.delete(`/chatrooms/${room.id}/members/${admin.id}`);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Chat room not found' });
    expect(await memberIdsOf(room.id)).toEqual([admin.id]);
  });

  it('rejects an unauthenticated request', async () => {
    const res = await request(app).delete('/chatrooms/1/members/2');

    expect(res.status).toBe(401);
  });

  it.each([
    ['a non-numeric id', 'abc'],
    ['a decimal id', '1.5'],
    ['a zero id', '0'],
    ['a negative id', '-3'],
    ['an id in scientific notation', '1e3'],
    ['an id larger than a Postgres integer', '2147483648'],
  ])('rejects %s with 400', async (_label, userId) => {
    const admin = await createUser('Alice', 'alice@example.com', '+14155552671');
    const room = await createGroupRoom(admin.id);
    const agent = await loginAs(admin);

    const res = await agent.delete(`/chatrooms/${room.id}/members/${userId}`);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ message: 'Invalid user id' });
    expect(await memberIdsOf(room.id)).toEqual([admin.id]);
  });

  describe('in a direct room', () => {
    it("rejects removing the other member, even though both users are admins", async () => {
      const alice = await createUser('Alice', 'alice@example.com', '+14155552671');
      const bob = await createUser('Bob', 'bob@example.com', '+14155552672');
      const room = await createDirectRoom(alice.id, bob.id);
      const agent = await loginAs(alice);

      const res = await agent.delete(`/chatrooms/${room.id}/members/${bob.id}`);

      expect(res.status).toBe(403);
      expect(res.body).toEqual({
        message: 'You can only remove yourself from a direct chat room',
      });
      expect(await memberIdsOf(room.id)).toEqual([alice.id, bob.id]);
    });

    it('lets a member leave without the last-admin rule getting in the way', async () => {
      const alice = await createUser('Alice', 'alice@example.com', '+14155552671');
      const bob = await createUser('Bob', 'bob@example.com', '+14155552672');
      const room = await createDirectRoom(alice.id, bob.id);
      const aliceAgent = await loginAs(alice);
      const bobAgent = await loginAs(bob);

      const aliceLeaves = await aliceAgent.delete(`/chatrooms/${room.id}/members/${alice.id}`);
      expect(aliceLeaves.status).toBe(204);
      expect(await memberIdsOf(room.id)).toEqual([bob.id]);
      expect((await prisma.chatRoom.findUniqueOrThrow({ where: { id: room.id } })).emptiedAt).toBeNull();

      // Bob is now the only member (and the only admin), so nobody else is
      // left for the last-admin rule to protect.
      const bobLeaves = await bobAgent.delete(`/chatrooms/${room.id}/members/${bob.id}`);
      expect(bobLeaves.status).toBe(204);
      expect(await memberIdsOf(room.id)).toEqual([]);
      expect(await prisma.chatRoom.findUnique({ where: { id: room.id } })).not.toBeNull();
      expect((await prisma.chatRoom.findUniqueOrThrow({ where: { id: room.id } })).emptiedAt).not.toBeNull();
    });
  });
});
