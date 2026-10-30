import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import app from '../../src/app';
import { hashPassword } from '../../src/lib/passwordHash';
import { prisma } from '../../src/lib/prisma';
import { findUserByEmail } from '../../src/modules/account/account.service';
import { findUserByTel } from '../../src/modules/friends/friend.service';
import { createDirectRoom, createGroupRoom, createPrivateRoom, findBot } from '../helpers/chatRooms';
import { makeFriends } from '../helpers/friends';
import { outbox } from '../helpers/mailer';
import { countUsers, createUser, loginAs } from '../helpers/users';

// Every account has a private room with a hidden bot (see "Private chat room" in backend.doc.md).

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

afterEach(() => {
  vi.restoreAllMocks();
});

describe('a new account', () => {
  it('gets a direct room with the bot, both of them admins, made together with the account', async () => {
    const bot = await findBot();

    const alice = await signUp('Alice');

    const rooms = await roomsOf(alice.id);
    expect(rooms).toHaveLength(1);
    expect(rooms[0]).toMatchObject({ type: 'direct', name: null, avatarUrl: null, emptiedAt: null });
    expect(rooms[0]!.members.map(({ memberId, role }) => [memberId, role]).sort()).toEqual(
      [
        [alice.id, 'admin'],
        [bot.id, 'admin'],
      ].sort(),
    );
    expect(await prisma.message.count()).toBe(0);
  });

  it('sees that room in its room list as a direct room named after the bot, with nothing in it', async () => {
    const alice = await signUp('Alice');
    const [room] = await roomsOf(alice.id);
    const agent = await loginAs(alice);

    const res = await agent.get('/api/chat');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      chatRooms: [
        {
          id: room!.id,
          type: 'direct',
          name: 'My Documents',
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

  it('is not created at all when the bot is missing: no account without its room', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const bot = await findBot();
    // The row cannot be deleted (see the backfill test), so it is made not to be found by its email.
    await prisma.user.update({ where: { id: bot.id }, data: { email: 'moved@bot.invalid' } });

    try {
      const res = await request(app)
        .post(signUpRoute)
        .send({ name: 'Alice', email: 'alice@example.com', tel: '+14155552671', password: 'Str0ng!Pass' });

      expect(res.status).toBe(500);
      expect(await countUsers()).toBe(0);
      expect(await prisma.emailVerificationToken.count()).toBe(0);
      expect(await prisma.chatRoom.count()).toBe(0);
    } finally {
      await prisma.user.update({ where: { id: bot.id }, data: { email: bot.email } });
    }
  });
});

describe('the bot is hidden', () => {
  it('cannot log in, and the answer is the one for a wrong password', async () => {
    const bot = await findBot();

    const res = await request(app).post('/api/account/login').send({ email: bot.email, password: 'Str0ng!Pass' });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Invalid email or password' });
    expect(await prisma.session.count()).toBe(0);
  });

  it('is not found by email, which is how every login and every reset starts', async () => {
    const bot = await findBot();
    const alice = await createUser('Alice');

    expect(await findUserByEmail(bot.email)).toBeNull();
    expect(await findUserByEmail(alice.email)).toMatchObject({ id: alice.id });
  });

  it('is sent no reset or verification link, and the answer is the one for any address', async () => {
    const bot = await findBot();

    const res = await request(app).post('/api/account/password/reset-request').send({ email: bot.email });

    expect(res.status).toBe(202);
    expect(outbox.sent).toEqual([]);
    expect(await prisma.passwordResetToken.count()).toBe(0);
    expect(await prisma.emailVerificationToken.count()).toBe(0);
  });

  it('is nobody a friend request can go to, and a search by its number finds nobody', async () => {
    const bot = await findBot();
    const alice = await createUser('Alice');
    const agent = await loginAs(alice);

    const res = await agent.post('/api/friend/requests').send({ receiver_id: bot.id });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'receiver_id does not refer to an existing user' });
    expect(await prisma.pendingFriendRequest.count()).toBe(0);
    expect(await findUserByTel(alice.id, bot.tel)).toBeNull();
  });

  it('cannot be made a room with by its id: that is refused like a room with a stranger', async () => {
    const bot = await findBot();
    const alice = await createUser('Alice');
    const agent = await loginAs(alice);

    const direct = await agent.post('/api/chat').send({ type: 'direct', member_ids: [bot.id] });
    const group = await agent.post('/api/chat').send({ type: 'group', name: 'Plan', member_ids: [bot.id] });

    expect(direct.status).toBe(403);
    expect(group.status).toBe(403);
    expect(await prisma.chatRoom.count()).toBe(0);
  });

  it('is not in the member list of the private room, where its owner is the only one', async () => {
    const alice = await createUser('Alice');
    const room = await createPrivateRoom(alice.id);
    const agent = await loginAs(alice);

    const res = await agent.get(`/api/chat/${room.id}/member`);

    expect(res.status).toBe(200);
    expect(res.body.members).toHaveLength(1);
    expect(res.body.members[0]).toMatchObject({ role: 'admin', member: { id: alice.id, name: 'Alice', avatarUrl: null } });
  });
});

describe('the private room', () => {
  it('takes messages like any room, and never has anything unread: the bot writes nothing', async () => {
    const alice = await createUser('Alice');
    const room = await createPrivateRoom(alice.id);
    const agent = await loginAs(alice);

    const sent = await agent.post(`/api/chat/${room.id}/message`).send({ content: 'Buy milk' });
    await agent.post(`/api/chat/${room.id}/message`).send({ content: 'Call mum' });

    expect(sent.status).toBe(201);
    const list = (await agent.get('/api/chat')).body.chatRooms;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: 'My Documents', unreadCount: 0, lastMessage: { content: 'Call mum' } });
    const messages = (await agent.get(`/api/chat/${room.id}/message`)).body.messages;
    expect(messages.map(({ content }: { content: string }) => content)).toEqual(['Call mum', 'Buy milk']);
  });

  it('cannot be left, and the membership stays', async () => {
    const alice = await createUser('Alice');
    const room = await createPrivateRoom(alice.id);
    const agent = await loginAs(alice);

    const res = await agent.delete(`/api/chat/${room.id}/member/${alice.id}`);

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'You cannot leave your private chat room' });
    expect(await prisma.chatMember.count({ where: { chatId: room.id } })).toBe(2);
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

  it('deletes the private room and its messages with it, and nothing else: the bot and the other rooms stay', async () => {
    const alice = await createUserWithPassword('Alice');
    const bea = await createUser('Bea');
    const bot = await findBot();
    await makeFriends(alice.id, bea.id);
    const privateRoom = await createPrivateRoom(alice.id);
    const beasPrivateRoom = await createPrivateRoom(bea.id);
    const direct = await createDirectRoom(alice.id, bea.id);
    const group = await createGroupRoom(bea.id, [alice.id]);
    await prisma.message.createMany({
      data: [
        { chatId: privateRoom.id, senderId: alice.id, content: 'note to self' },
        { chatId: beasPrivateRoom.id, senderId: bea.id, content: 'Bea\'s note' },
        { chatId: direct.id, senderId: alice.id, content: 'hi Bea' },
      ],
    });
    const agent = await loginAs(alice);

    const res = await agent.delete('/api/account/me').send({ password });

    expect(res.status).toBe(204);
    expect(await prisma.chatRoom.count({ where: { id: privateRoom.id } })).toBe(0);
    expect(await prisma.message.count({ where: { chatId: privateRoom.id } })).toBe(0);
    expect(await prisma.user.count({ where: { id: bot.id } })).toBe(1);
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
    expect(await prisma.chatMember.count({ where: { chatId: room.id } })).toBe(2);
  });
});
