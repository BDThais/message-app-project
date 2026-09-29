import { describe, expect, it } from 'vitest';
import { prisma } from '../../src/lib/prisma';
import { createUser, loginAs } from '../helpers/users';
import { createDirectRoom, createGroupRoom } from '../helpers/chatRooms';

// The session/membership guard on this route is covered once for every route
// in chatRoom.permissions.test.ts; the ':message_id' format check is in
// chatRoom.validator.unit.test.ts.

const messageUrl = (chatId: number, messageId: number | string) =>
  `/chat/${chatId}/message/${messageId}`;

describe('DELETE /chat/:chatid/message/:message_id', () => {
  it('lets the sender delete their own message in a group room', async () => {
    const admin = await createUser('Alice');
    const member = await createUser('Bob');
    const room = await createGroupRoom(admin.id, [member.id]);
    const agent = await loginAs(member);
    const sent = await agent.post(`/chat/${room.id}/message`).send({ content: 'Hello!' });

    const res = await agent.delete(messageUrl(room.id, sent.body.message.id));

    expect(res.status).toBe(204);
    expect(res.text).toBe('');
    const message = await prisma.message.findUniqueOrThrow({ where: { id: sent.body.message.id } });
    expect(message.deletedAt).not.toBeNull();
    expect(message.content).toBe('');
  });

  it('lets either member of a direct room delete their own message', async () => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');
    const room = await createDirectRoom(alice.id, bob.id);
    const agent = await loginAs(bob);
    const sent = await agent.post(`/chat/${room.id}/message`).send({ content: 'Hi Alice' });

    const res = await agent.delete(messageUrl(room.id, sent.body.message.id));

    expect(res.status).toBe(204);
    expect(
      (await prisma.message.findUniqueOrThrow({ where: { id: sent.body.message.id } })).deletedAt
    ).not.toBeNull();
  });

  it('is reflected in a later GET as a deleted, content-less message', async () => {
    const user = await createUser('Alice');
    const room = await createGroupRoom(user.id);
    const agent = await loginAs(user);
    const sent = await agent.post(`/chat/${room.id}/message`).send({ content: 'Oops' });

    await agent.delete(messageUrl(room.id, sent.body.message.id));
    const res = await agent.get(`/chat/${room.id}/message`);

    expect(res.body.messages[0]).toMatchObject({
      id: sent.body.message.id,
      content: '',
      deletedAt: expect.any(String),
    });
  });

  it('rejects a non-sender, including an admin, with 403 and leaves the message untouched', async () => {
    const admin = await createUser('Alice');
    const member = await createUser('Bob');
    const room = await createGroupRoom(admin.id, [member.id]);
    const memberAgent = await loginAs(member);
    const sent = await memberAgent.post(`/chat/${room.id}/message`).send({ content: 'Mine' });
    const adminAgent = await loginAs(admin);

    const res = await adminAgent.delete(messageUrl(room.id, sent.body.message.id));

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'You can only delete your own messages' });
    expect(
      (await prisma.message.findUniqueOrThrow({ where: { id: sent.body.message.id } })).deletedAt
    ).toBeNull();
  });

  it('returns 404 for a message that does not exist or was already deleted', async () => {
    const user = await createUser('Alice');
    const room = await createGroupRoom(user.id);
    const agent = await loginAs(user);
    const sent = await agent.post(`/chat/${room.id}/message`).send({ content: 'Once' });
    await agent.delete(messageUrl(room.id, sent.body.message.id));

    const noSuchMessage = await agent.delete(messageUrl(room.id, 999_999));
    const alreadyDeleted = await agent.delete(messageUrl(room.id, sent.body.message.id));

    for (const res of [noSuchMessage, alreadyDeleted]) {
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'Message not found in this chat room' });
    }
  });

  it('returns 404 for a message id that belongs to a different chat room', async () => {
    const user = await createUser('Alice');
    const roomA = await createGroupRoom(user.id, [], 'Room A');
    const roomB = await createGroupRoom(user.id, [], 'Room B');
    const agent = await loginAs(user);
    const sent = await agent.post(`/chat/${roomA.id}/message`).send({ content: 'In room A' });

    const res = await agent.delete(messageUrl(roomB.id, sent.body.message.id));

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Message not found in this chat room' });
  });

  it('rejects an invalid message id with 400', async () => {
    const user = await createUser('Alice');
    const room = await createGroupRoom(user.id);
    const agent = await loginAs(user);

    const res = await agent.delete(messageUrl(room.id, 'abc'));

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid message id' });
  });
});
