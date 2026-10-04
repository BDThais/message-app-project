import { describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../../src/app';
import config from '../../src/config/config';
import { hashPassword } from '../../src/lib/passwordHash';
import { prisma } from '../../src/lib/prisma';
import { deleteAccount } from '../../src/modules/account/account.service';
import { createDirectRoom, createGroupRoom, memberIdsOf, promoteToAdmin } from '../helpers/chatRooms';
import { createFriendRequest, makeFriends } from '../helpers/friends';
import { createSessionRow, createUser, loginAs } from '../helpers/users';

const route = '/account/me';
const password = 'Str0ng!Pass';

/** A user who really has `password` (the helper's hash is a placeholder). */
async function createUserWithPassword(name: string) {
  const user = await createUser(name);
  return prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(password) } });
}

// The full list of bad bodies is in deleteAccount.validator.unit.test.ts.

describe(`DELETE ${route}`, () => {
  it('returns 401 without a session', async () => {
    const res = await request(app).delete(route).send({ password });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Unauthorized Access' });
  });

  it('returns 400 without a password and deletes nothing', async () => {
    const alice = await createUserWithPassword('Alice');
    const agent = await loginAs(alice);

    const res = await agent.delete(route).send({});

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Password is required' });
    expect(await prisma.user.count({ where: { id: alice.id } })).toBe(1);
  });

  it('returns 401 when the password is wrong, and deletes nothing', async () => {
    const alice = await createUserWithPassword('Alice');
    const agent = await loginAs(alice);

    const res = await agent.delete(route).send({ password: 'Wrong!Pass1' });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Password is incorrect' });
    expect(await prisma.user.count({ where: { id: alice.id } })).toBe(1);
    expect(await prisma.session.count({ where: { userId: alice.id } })).toBe(1);
  });

  it("returns 204, deletes the user and all their sessions, clears the cookie, and touches nobody else's", async () => {
    const alice = await createUserWithPassword('Alice');
    const bob = await createUser('Bob');
    const agent = await loginAs(alice);
    await loginAs(alice);
    await createSessionRow(alice.id, new Date(Date.now() - 1000));
    const bobAgent = await loginAs(bob);

    const res = await agent.delete(route).send({ password });

    expect(res.status).toBe(204);
    expect(res.body).toEqual({});
    expect(res.headers['set-cookie']?.[0]).toMatch(new RegExp(`^${config.SESSION_COOKIE}=;.*Expires=Thu, 01 Jan 1970`));
    expect(await prisma.user.count({ where: { id: alice.id } })).toBe(0);
    expect(await prisma.session.count({ where: { userId: alice.id } })).toBe(0);
    expect((await agent.get('/account/me')).body).toEqual({ user: null });
    expect((await bobAgent.get('/account/me')).body.user).toMatchObject({ id: bob.id });
  });

  it('frees the email so nobody can log in with the old credentials', async () => {
    const alice = await createUserWithPassword('Alice');
    const agent = await loginAs(alice);

    await agent.delete(route).send({ password });
    const login = await request(app).post('/account/login').send({ email: alice.email, password });

    expect(login.status).toBe(401);
  });

  it('removes their friendships and friend requests in both directions, and only theirs', async () => {
    const alice = await createUserWithPassword('Alice');
    const bob = await createUser('Bob');
    const carol = await createUser('Carol');
    const dave = await createUser('Dave');
    await makeFriends(alice.id, bob.id);
    await makeFriends(bob.id, carol.id);
    await createFriendRequest(alice.id, dave.id);
    await createFriendRequest(carol.id, alice.id);
    await createFriendRequest(carol.id, dave.id);
    const agent = await loginAs(alice);

    const res = await agent.delete(route).send({ password });

    expect(res.status).toBe(204);
    expect(await prisma.friendListMember.findMany({ select: { userId: true, friendId: true } })).toEqual(
      expect.arrayContaining([
        { userId: bob.id, friendId: carol.id },
        { userId: carol.id, friendId: bob.id },
      ])
    );
    expect(await prisma.friendListMember.count()).toBe(2);
    expect(await prisma.pendingFriendRequest.findMany({ select: { senderId: true, receiverId: true } })).toEqual([
      { senderId: carol.id, receiverId: dave.id },
    ]);
  });

  it('keeps their messages in the room, with no sender, and leaves the room working for the others', async () => {
    const alice = await createUserWithPassword('Alice');
    const bob = await createUser('Bob');
    const room = await createGroupRoom(bob.id, [alice.id]);
    const aliceAgent = await loginAs(alice);
    const bobAgent = await loginAs(bob);
    await aliceAgent.post(`/chat/${room.id}/message`).send({ content: 'Bye soon' });

    const res = await aliceAgent.delete(route).send({ password });

    expect(res.status).toBe(204);
    expect(await memberIdsOf(room.id)).toEqual([bob.id]);
    const messages = await bobAgent.get(`/chat/${room.id}/message`);
    expect(messages.status).toBe(200);
    expect(messages.body.messages).toMatchObject([{ content: 'Bye soon', senderId: null, sender: null }]);
    expect((await bobAgent.post(`/chat/${room.id}/message`).send({ content: 'Still here' })).status).toBe(201);
  });

  it('leaves a direct room to the other person, who can still list it and read it', async () => {
    const alice = await createUserWithPassword('Alice');
    const bob = await createUser('Bob');
    const room = await createDirectRoom(alice.id, bob.id);
    const aliceAgent = await loginAs(alice);
    const bobAgent = await loginAs(bob);
    await aliceAgent.post(`/chat/${room.id}/message`).send({ content: 'Hi Bob' });

    await aliceAgent.delete(route).send({ password });

    const list = await bobAgent.get('/chat');
    expect(list.status).toBe(200);
    expect(list.body.chatRooms).toMatchObject([{ id: room.id, type: 'direct', name: null, avatarUrl: null }]);
    const single = await bobAgent.get(`/chat/${room.id}`);
    expect(single.status).toBe(200);
    expect(single.body.chatRoom).toMatchObject({ id: room.id, type: 'direct', name: null });
    expect((await bobAgent.get(`/chat/${room.id}/message`)).body.messages).toHaveLength(1);
  });

  it('lets an admin go when another admin stays, or when nobody else is in the room', async () => {
    const alice = await createUserWithPassword('Alice');
    const bob = await createUser('Bob');
    const carol = await createUser('Carol');
    const shared = await createGroupRoom(alice.id, [bob.id, carol.id]);
    await promoteToAdmin(shared.id, bob.id);
    const solo = await createGroupRoom(alice.id);
    const agent = await loginAs(alice);

    const res = await agent.delete(route).send({ password });

    expect(res.status).toBe(204);
    expect(await memberIdsOf(shared.id)).toEqual([bob.id, carol.id]);
    expect(await memberIdsOf(solo.id)).toEqual([]);
  });

  it('starts the cleanup clock of a room that the deletion empties, and of no other room', async () => {
    const alice = await createUserWithPassword('Alice');
    const bob = await createUser('Bob');
    const solo = await createGroupRoom(alice.id);
    const shared = await createGroupRoom(bob.id, [alice.id]);
    const agent = await loginAs(alice);

    await agent.delete(route).send({ password });

    expect((await prisma.chatRoom.findUniqueOrThrow({ where: { id: solo.id } })).emptiedAt).toBeInstanceOf(Date);
    expect((await prisma.chatRoom.findUniqueOrThrow({ where: { id: shared.id } })).emptiedAt).toBeNull();
  });

  it('returns 409 listing the rooms where they are the only admin, and deletes nothing at all', async () => {
    const alice = await createUserWithPassword('Alice');
    const bob = await createUser('Bob');
    const carol = await createUser('Carol');
    const first = await createGroupRoom(alice.id, [bob.id]);
    const second = await createGroupRoom(alice.id, [carol.id]);
    const asMember = await createGroupRoom(bob.id, [alice.id]);
    const agent = await loginAs(alice);

    const res = await agent.delete(route).send({ password });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      error: expect.stringContaining('only admin'),
      chatIds: [first.id, second.id],
    });
    expect(await prisma.user.count({ where: { id: alice.id } })).toBe(1);
    expect(await prisma.session.count({ where: { userId: alice.id } })).toBe(1);
    expect(await memberIdsOf(asMember.id)).toEqual([alice.id, bob.id]);
  });

  it('goes through once another admin is appointed in each such room', async () => {
    const alice = await createUserWithPassword('Alice');
    const bob = await createUser('Bob');
    const room = await createGroupRoom(alice.id, [bob.id]);
    const agent = await loginAs(alice);
    expect((await agent.delete(route).send({ password })).status).toBe(409);

    await promoteToAdmin(room.id, bob.id);
    const res = await agent.delete(route).send({ password });

    expect(res.status).toBe(204);
    expect(await memberIdsOf(room.id)).toEqual([bob.id]);
  });

  it('shares the 10-attempt budget with POST /account/password, counted per user', async () => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');
    const aliceAgent = await loginAs(alice);
    const bobAgent = await loginAs(bob);

    for (let i = 0; i < 5; i++) {
      expect((await aliceAgent.post('/account/password').send({})).status, `change ${i + 1}`).toBe(400);
      expect((await aliceAgent.delete(route).send({})).status, `delete ${i + 1}`).toBe(400);
    }
    const blocked = await aliceAgent.delete(route).send({});
    const otherUser = await bobAgent.delete(route).send({});

    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({ error: 'Too many attempts, try again later' });
    expect(otherUser.status).toBe(400);
  });
});

describe('deleteAccount (service)', () => {
  it('deletes nothing when the stored hash is no longer the one that was verified', async () => {
    const alice = await createUser('Alice');
    await loginAs(alice);

    // The caller verified 'stale-hash', but another request has changed the password since.
    const result = await deleteAccount(alice.id, 'stale-hash');

    expect(result).toEqual({ status: 'stale_password' });
    expect(await prisma.user.count({ where: { id: alice.id } })).toBe(1);
    expect(await prisma.session.count({ where: { userId: alice.id } })).toBe(1);
  });

  it('lets only one of two admins delete their account at the same moment', async () => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');
    const carol = await createUser('Carol');
    const room = await createGroupRoom(alice.id, [bob.id, carol.id]);
    await promoteToAdmin(room.id, bob.id);

    // Each one alone is fine (the other is still an admin). Without the lock on the room, both
    // would see the other admin and both would go, leaving Carol in a room with no admin.
    const results = await Promise.all([
      deleteAccount(alice.id, alice.passwordHash),
      deleteAccount(bob.id, bob.passwordHash),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual(['deleted', 'only_admin']);
    const admins = await prisma.chatMember.count({ where: { chatId: room.id, role: 'admin' } });
    expect(admins).toBe(1);
  });
});
