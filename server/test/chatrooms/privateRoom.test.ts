import { describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../../src/app';
import { hashPassword } from '../../src/lib/passwordHash';
import { prisma } from '../../src/lib/prisma';
import { createDirectRoom, createGroupRoom, createPrivateRoom } from '../helpers/chatRooms';
import { makeFriends } from '../helpers/friends';
import { createUser, loginAs } from '../helpers/users';

// Every account has a private room: a room of its own type with the account as its only member (see
// "Private chat room" in backend.doc.md).

const signUpRoute = '/api/account/signup';

async function signUp(name: string) {
  const email = `${name.toLowerCase()}@example.com`;
  const tel = `+1415555${String(name.length).padStart(4, '0')}${name.charCodeAt(0)}`.slice(0, 12);
  const res = await request(app).post(signUpRoute).send({ name, email, tel, password: 'Str0ng!Pass' });
  expect(res.status).toBe(201);
  return prisma.user.findUniqueOrThrow({ where: { email } });
}

const roomsOf = (userId: number) =>
  prisma.chatRoom.findMany({
    where: { members: { some: { memberId: userId } } },
    include: { members: { orderBy: { memberId: 'asc' } } },
  });

describe('a new account', () => {
  it('gets a private room with only itself in it, as its admin, made together with the account', async () => {
    const alice = await signUp('Alice');

    const rooms = await roomsOf(alice.id);
    expect(rooms).toHaveLength(1);
    expect(rooms[0]).toMatchObject({ type: 'private', name: null, avatarUrl: null, emptiedAt: null });
    expect(rooms[0]!.members.map(({ memberId, role }) => [memberId, role])).toEqual([[alice.id, 'admin']]);
    expect(await prisma.message.count()).toBe(0);
  });

  it('sees that room in its room list as a private room with no name, and nothing in it', async () => {
    const alice = await signUp('Alice');
    const [room] = await roomsOf(alice.id);
    const agent = await loginAs(alice);

    const res = await agent.get('/api/chat');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      chatRooms: [
        {
          id: room!.id,
          type: 'private',
          name: null,
          avatarUrl: null,
          createdAt: expect.any(String),
          lastMessage: null,
          unreadCount: 0,
        },
      ],
    });
  });

  it('gets a room of its own: nobody else is in it, and nobody else can open it', async () => {
    const alice = await signUp('Alice');
    const bea = await signUp('Bea');
    const [aliceRoom] = await roomsOf(alice.id);
    const [beaRoom] = await roomsOf(bea.id);

    expect(aliceRoom!.id).not.toBe(beaRoom!.id);
    const asBea = await loginAs(bea);
    expect((await asBea.get('/api/chat')).body.chatRooms.map(({ id }: { id: number }) => id)).toEqual([beaRoom!.id]);
    expect((await asBea.get(`/api/chat/${aliceRoom!.id}`)).status).toBe(404);
    expect((await asBea.get(`/api/chat/${aliceRoom!.id}/message`)).status).toBe(404);
  });

  it('gets no room when the signup is refused', async () => {
    await signUp('Alice');

    const again = await request(app)
      .post(signUpRoute)
      .send({ name: 'Other', email: 'alice@example.com', tel: '+14155559999', password: 'Str0ng!Pass' });

    expect(again.status).toBe(409);
    expect(await prisma.chatRoom.count()).toBe(1);
  });
});

describe('the private room', () => {
  it('is one room with its owner as the only member, who is listed with their role', async () => {
    const alice = await createUser('Alice');
    const room = await createPrivateRoom(alice.id);
    const agent = await loginAs(alice);

    const detail = await agent.get(`/api/chat/${room.id}`);
    const members = await agent.get(`/api/chat/${room.id}/member`);

    expect(detail.status).toBe(200);
    expect(detail.body.chatRoom).toMatchObject({
      id: room.id,
      type: 'private',
      name: null,
      avatarUrl: null,
      role: 'admin',
    });
    expect(members.status).toBe(200);
    expect(members.body.members).toHaveLength(1);
    expect(members.body.members[0]).toMatchObject({
      role: 'admin',
      member: { id: alice.id, name: 'Alice', avatarUrl: null },
    });
  });

  it('takes messages like any room, and never has anything unread: nobody else writes in it', async () => {
    const alice = await createUser('Alice');
    const room = await createPrivateRoom(alice.id);
    const agent = await loginAs(alice);

    const sent = await agent.post(`/api/chat/${room.id}/message`).send({ content: 'Buy milk' });
    await agent.post(`/api/chat/${room.id}/message`).send({ content: 'Call mum' });

    expect(sent.status).toBe(201);
    const list = (await agent.get('/api/chat')).body.chatRooms;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      type: 'private',
      name: null,
      unreadCount: 0,
      lastMessage: { content: 'Call mum' },
    });
    const messages = (await agent.get(`/api/chat/${room.id}/message`)).body.messages;
    expect(messages.map(({ content }: { content: string }) => content)).toEqual(['Call mum', 'Buy milk']);
  });

  it('is listed with the other rooms of its owner, each as what it is', async () => {
    const alice = await createUser('Alice');
    const bea = await createUser('Bea');
    const privateRoom = await createPrivateRoom(alice.id);
    const direct = await createDirectRoom(alice.id, bea.id);
    const group = await createGroupRoom(alice.id, [bea.id], 'Plan');
    const agent = await loginAs(alice);

    const rooms = (await agent.get('/api/chat')).body.chatRooms as { id: number; type: string; name: string | null }[];

    expect(rooms.map(({ id, type, name }) => [id, type, name]).sort((a, b) => Number(a[0]) - Number(b[0]))).toEqual(
      [
        [privateRoom.id, 'private', null],
        [direct.id, 'direct', 'Bea'],
        [group.id, 'group', 'Plan'],
      ].sort((a, b) => Number(a[0]) - Number(b[0])),
    );
  });

  it('cannot be left, and the membership stays', async () => {
    const alice = await createUser('Alice');
    const room = await createPrivateRoom(alice.id);
    const agent = await loginAs(alice);

    const res = await agent.delete(`/api/chat/${room.id}/member/${alice.id}`);

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'You cannot leave your private chat room' });
    expect(await prisma.chatMember.count({ where: { chatId: room.id } })).toBe(1);
  });

  it('has nobody else to remove', async () => {
    const alice = await createUser('Alice');
    const bea = await createUser('Bea');
    const room = await createPrivateRoom(alice.id);
    const agent = await loginAs(alice);

    const res = await agent.delete(`/api/chat/${room.id}/member/${bea.id}`);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Member not found in this chat room' });
  });

  it('is refused every action that is for group rooms only, though its owner is an admin', async () => {
    const alice = await createUser('Alice');
    const bea = await createUser('Bea');
    await makeFriends(alice.id, bea.id);
    const room = await createPrivateRoom(alice.id);
    const agent = await loginAs(alice);
    const refused = { error: 'Not available for your private chat room' };

    const rename = await agent.patch(`/api/chat/${room.id}`).send({ name: 'Mine' });
    const add = await agent.post(`/api/chat/${room.id}/member`).send({ member_ids: [bea.id] });
    const role = await agent.patch(`/api/chat/${room.id}/member/${alice.id}`).send({ role: 'member' });
    const remove = await agent.delete(`/api/chat/${room.id}`);

    for (const res of [rename, add, role, remove]) {
      expect(res.status).toBe(403);
      expect(res.body).toEqual(refused);
    }
    expect(await prisma.chatRoom.findUniqueOrThrow({ where: { id: room.id } })).toMatchObject({
      type: 'private',
      name: null,
    });
    expect(await prisma.chatMember.findMany({ where: { chatId: room.id } })).toMatchObject([
      { memberId: alice.id, role: 'admin' },
    ]);
  });

  it('cannot be asked for: POST /api/chat makes direct and group rooms only', async () => {
    const alice = await createUser('Alice');
    const agent = await loginAs(alice);

    const res = await agent.post('/api/chat').send({ type: 'private' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'type must be "direct" or "group"' });
    expect(await prisma.chatRoom.count()).toBe(0);
  });

  it('is not the direct room of its owner and a friend, which is made beside it and found again', async () => {
    const alice = await createUser('Alice');
    const bea = await createUser('Bea');
    await makeFriends(alice.id, bea.id);
    const room = await createPrivateRoom(alice.id);
    const agent = await loginAs(alice);

    const first = await agent.post('/api/chat').send({ type: 'direct', member_ids: [bea.id] });
    const second = await agent.post('/api/chat').send({ type: 'direct', member_ids: [bea.id] });

    expect(first.status).toBe(201);
    expect(first.body.chatRoom).toMatchObject({ type: 'direct', name: 'Bea' });
    expect(first.body.chatRoom.id).not.toBe(room.id);
    expect(second.status).toBe(200);
    expect(second.body.chatRoom.id).toBe(first.body.chatRoom.id);
  });

  it('does not stop anyone from leaving a direct room with a friend', async () => {
    const alice = await createUser('Alice');
    const bea = await createUser('Bea');
    await createPrivateRoom(alice.id);
    const room = await createDirectRoom(alice.id, bea.id);
    const agent = await loginAs(alice);

    const res = await agent.delete(`/api/chat/${room.id}/member/${alice.id}`);

    expect(res.status).toBe(204);
  });
});

describe('deleting the account', () => {
  const password = 'Str0ng!Pass';

  async function createUserWithPassword(name: string) {
    const user = await createUser(name);
    return prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(password) } });
  }

  it('deletes the private room and its messages with it, and nothing else: the other rooms stay', async () => {
    const alice = await createUserWithPassword('Alice');
    const bea = await createUser('Bea');
    await makeFriends(alice.id, bea.id);
    const privateRoom = await createPrivateRoom(alice.id);
    const beasPrivateRoom = await createPrivateRoom(bea.id);
    const direct = await createDirectRoom(alice.id, bea.id);
    const group = await createGroupRoom(bea.id, [alice.id]);
    await prisma.message.createMany({
      data: [
        { chatId: privateRoom.id, senderId: alice.id, content: 'note to self' },
        { chatId: beasPrivateRoom.id, senderId: bea.id, content: "Bea's note" },
        { chatId: direct.id, senderId: alice.id, content: 'hi Bea' },
      ],
    });
    const agent = await loginAs(alice);

    const res = await agent.delete('/api/account/me').send({ password });

    expect(res.status).toBe(204);
    expect(await prisma.chatRoom.count({ where: { id: privateRoom.id } })).toBe(0);
    expect(await prisma.message.count({ where: { chatId: privateRoom.id } })).toBe(0);
    const left = await prisma.chatRoom.findMany({ select: { id: true }, orderBy: { id: 'asc' } });
    expect(left.map(({ id }) => id)).toEqual([beasPrivateRoom.id, direct.id, group.id].sort((a, b) => a - b));
    expect(await prisma.message.count()).toBe(2);
  });

  it('keeps the private room when the deletion is refused', async () => {
    const alice = await createUserWithPassword('Alice');
    const room = await createPrivateRoom(alice.id);
    const agent = await loginAs(alice);

    const res = await agent.delete('/api/account/me').send({ password: 'Wrong!Pass1' });

    expect(res.status).toBe(401);
    expect(await prisma.chatMember.count({ where: { chatId: room.id } })).toBe(1);
  });
});
