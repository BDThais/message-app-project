import { describe, expect, it } from 'vitest';
import { prisma } from '../../src/lib/prisma';
import { createUser, loginAs } from '../helpers/users';
import { createDirectRoom, createGroupRoom } from '../helpers/chatRooms';

// The session/membership guard on this route is covered once for every route
// in chatRoom.permissions.test.ts; the full list of bad content bodies is in
// chatRoom.validator.unit.test.ts.

describe('POST /chatrooms/:chatid/messages', () => {
  it('lets a regular member post a message to a group room', async () => {
    const admin = await createUser('Alice');
    const member = await createUser('Bob');
    const room = await createGroupRoom(admin.id, [member.id]);
    const agent = await loginAs(member);

    const res = await agent
      .post(`/chatrooms/${room.id}/messages`)
      .send({ content: '  Hello!  ' });

    expect(res.status).toBe(201);
    expect(res.body.message).toMatchObject({
      chatId: room.id,
      senderId: member.id,
      content: 'Hello!', // trimmed
      sender: { id: member.id, name: 'Bob', avatarUrl: null },
    });
    expect(res.body.message.id).toEqual(expect.any(Number));
    expect(res.body.message.createdAt).toEqual(expect.any(String));
    expect(await prisma.message.count({ where: { chatId: room.id } })).toBe(1);
  });

  it('lets either member of a direct room post a message', async () => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');
    const room = await createDirectRoom(alice.id, bob.id);
    const agent = await loginAs(bob);

    const res = await agent.post(`/chatrooms/${room.id}/messages`).send({ content: 'Hi Alice' });

    expect(res.status).toBe(201);
    expect(res.body.message).toMatchObject({
      chatId: room.id,
      senderId: bob.id,
      content: 'Hi Alice',
    });
  });

  it('becomes the room\'s lastMessage on GET /chatrooms', async () => {
    const user = await createUser('Alice');
    const room = await createGroupRoom(user.id);
    const agent = await loginAs(user);

    await agent.post(`/chatrooms/${room.id}/messages`).send({ content: 'First' });
    await agent.post(`/chatrooms/${room.id}/messages`).send({ content: 'Second' });

    const res = await agent.get('/chatrooms');

    expect(res.body.chatRooms[0]).toMatchObject({ id: room.id, lastMessage: { content: 'Second' } });
  });

  it('rejects a blank content body with 400 and creates no message', async () => {
    const user = await createUser('Alice');
    const room = await createGroupRoom(user.id);
    const agent = await loginAs(user);

    const res = await agent.post(`/chatrooms/${room.id}/messages`).send({ content: '   ' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ message: "'content' must be a non-empty string" });
    expect(await prisma.message.count({ where: { chatId: room.id } })).toBe(0);
  });
});
