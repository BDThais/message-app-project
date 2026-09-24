import { describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { createUser, loginAs, type TestAgent } from '../helpers/users';
import { createDirectRoom, createGroupRoom } from '../helpers/chatRooms';

// The middleware in front of the chat-room routes (requireUserAuth,
// loadChatMembership, requireGroupRoom, requireChatAdmin), checked once per
// route so a route added without the right guard gets caught. What the routes
// do once the guards let a request through is tested in the other files.

// Add new routes here (e.g. the message endpoints) so they are covered too.
const allRoutes = [
  ['post', '/chatrooms'],
  ['get', '/chatrooms'],
  ['get', '/chatrooms/1'],
  ['patch', '/chatrooms/1'],
  ['delete', '/chatrooms/1'],
  ['post', '/chatrooms/1/members'],
  ['delete', '/chatrooms/1/members/2'],
] as const;

describe('every chat-room route', () => {
  it('rejects a request without a session', async () => {
    for (const [method, path] of allRoutes) {
      const res = await request(app)[method](path);

      expect(res.status, `${method.toUpperCase()} ${path}`).toBe(401);
      expect(res.body).toEqual({ error: 'Unauthorized Access' });
    }
  });

  it('returns the same 404 for a room the user is not in and a room that does not exist', async () => {
    const owner = await createUser('Alice');
    const stranger = await createUser('Bob');
    const room = await createGroupRoom(owner.id);
    const agent = await loginAs(stranger);

    for (const chatId of [room.id, room.id + 1000]) {
      const res = await agent.get(`/chatrooms/${chatId}`);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ message: 'Chat room not found' });
    }
  });

  it('rejects a chat room id that is not an integer with 400', async () => {
    const user = await createUser('Alice');
    const agent = await loginAs(user);

    const res = await agent.get('/chatrooms/abc');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ message: 'Invalid chat room id' });
  });
});

// The routes that need requireGroupRoom + requireChatAdmin. Each must refuse
// a regular member and a direct room, and must change nothing when it does.
const adminOnlyRoutes = [
  {
    name: 'PATCH /chatrooms/:chatid',
    call: (agent: TestAgent, chatId: number) =>
      agent.patch(`/chatrooms/${chatId}`).send({ name: 'Not allowed' }),
  },
  {
    name: 'DELETE /chatrooms/:chatid',
    call: (agent: TestAgent, chatId: number) => agent.delete(`/chatrooms/${chatId}`),
  },
  {
    name: 'POST /chatrooms/:chatid/members',
    call: (agent: TestAgent, chatId: number) =>
      agent.post(`/chatrooms/${chatId}/members`).send({ member_ids: [999_999] }),
  },
];

describe.each(adminOnlyRoutes)('$name', ({ call }) => {
  it('rejects a regular member with 403', async () => {
    const admin = await createUser('Alice');
    const member = await createUser('Bob');
    const room = await createGroupRoom(admin.id, [member.id]);
    const agent = await loginAs(member);

    const res = await call(agent, room.id);

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ message: 'Admin role required for this action' });
    expect(await prisma.chatRoom.findUnique({ where: { id: room.id } })).toMatchObject({
      name: 'Project chat',
    });
    expect(await prisma.chatMember.count({ where: { chatId: room.id } })).toBe(2);
  });

  it('rejects a direct room with 403, even though both users are admins', async () => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');
    const room = await createDirectRoom(alice.id, bob.id);
    const agent = await loginAs(alice);

    const res = await call(agent, room.id);

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ message: 'Not available for direct chat rooms' });
    expect(await prisma.chatRoom.count({ where: { id: room.id } })).toBe(1);
    expect(await prisma.chatMember.count({ where: { chatId: room.id } })).toBe(2);
  });
});
