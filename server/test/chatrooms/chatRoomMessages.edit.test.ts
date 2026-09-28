import { afterEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../src/lib/prisma';
import { editMessage } from '../../src/modules/chatrooms/message.service';
import { createUser, loginAs } from '../helpers/users';
import { createDirectRoom, createGroupRoom } from '../helpers/chatRooms';

// The session/membership guard on this route is covered once for every route
// in chatRoom.permissions.test.ts; the ':message_id' format check and the full
// list of bad bodies are in chatRoom.validator.unit.test.ts.

const messageUrl = (chatId: number, messageId: number | string) =>
  `/chat/${chatId}/message/${messageId}`;

describe('PATCH /chat/:chatid/message/:message_id', () => {
  it('lets the sender edit their own message in a group room', async () => {
    const admin = await createUser('Alice');
    const member = await createUser('Bob');
    const room = await createGroupRoom(admin.id, [member.id]);
    const agent = await loginAs(member);
    const sent = await agent.post(`/chat/${room.id}/message`).send({ content: 'Helo!' });

    const res = await agent
      .patch(messageUrl(room.id, sent.body.message.id))
      .send({ content: '  Hello!  ' });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatchObject({
      id: sent.body.message.id,
      chatId: room.id,
      senderId: member.id,
      content: 'Hello!',
      createdAt: sent.body.message.createdAt,
      editedAt: expect.any(String),
      deletedAt: null,
      sender: { id: member.id, name: 'Bob', avatarUrl: null },
    });
    const stored = await prisma.message.findUniqueOrThrow({ where: { id: sent.body.message.id } });
    expect(stored.content).toBe('Hello!');
    expect(stored.editedAt).not.toBeNull();
  });

  it('lets either member of a direct room edit their own message', async () => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');
    const room = await createDirectRoom(alice.id, bob.id);
    const agent = await loginAs(bob);
    const sent = await agent.post(`/chat/${room.id}/message`).send({ content: 'Hi Alcie' });

    const res = await agent
      .patch(messageUrl(room.id, sent.body.message.id))
      .send({ content: 'Hi Alice' });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatchObject({ content: 'Hi Alice', editedAt: expect.any(String) });
  });

  it('is reflected in later reads without moving the message or the room', async () => {
    const user = await createUser('Alice');
    const room = await createGroupRoom(user.id);
    const agent = await loginAs(user);
    const first = await agent.post(`/chat/${room.id}/message`).send({ content: 'First' });
    const second = await agent.post(`/chat/${room.id}/message`).send({ content: 'Second' });

    await agent.patch(messageUrl(room.id, first.body.message.id)).send({ content: 'First (fixed)' });
    const messages = await agent.get(`/chat/${room.id}/message`);
    await agent.patch(messageUrl(room.id, second.body.message.id)).send({ content: 'Second (fixed)' });
    const rooms = await agent.get('/chat');

    // Still oldest, and it reports its new content plus the edited stamp.
    expect(messages.body.messages.map((m: { content: string }) => m.content)).toEqual([
      'Second',
      'First (fixed)',
    ]);
    expect(messages.body.messages[1].editedAt).toEqual(expect.any(String));
    // The room summary's last-message preview follows the edit; createdAt is untouched.
    expect(rooms.body.chatRooms[0].lastMessage).toMatchObject({ content: 'Second (fixed)' });
  });

  it('treats saving the same content as a no-op: 200, and editedAt stays null', async () => {
    const user = await createUser('Alice');
    const room = await createGroupRoom(user.id);
    const agent = await loginAs(user);
    const sent = await agent.post(`/chat/${room.id}/message`).send({ content: 'Same' });

    const res = await agent
      .patch(messageUrl(room.id, sent.body.message.id))
      .send({ content: ' Same ' });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatchObject({ content: 'Same', editedAt: null });
    expect(
      (await prisma.message.findUniqueOrThrow({ where: { id: sent.body.message.id } })).editedAt
    ).toBeNull();
  });

  it('rejects a non-sender, including an admin, with 403 and leaves the message untouched', async () => {
    const admin = await createUser('Alice');
    const member = await createUser('Bob');
    const room = await createGroupRoom(admin.id, [member.id]);
    const memberAgent = await loginAs(member);
    const sent = await memberAgent.post(`/chat/${room.id}/message`).send({ content: 'Mine' });
    const adminAgent = await loginAs(admin);

    const res = await adminAgent
      .patch(messageUrl(room.id, sent.body.message.id))
      .send({ content: 'Not yours' });

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ message: 'You can only edit your own messages' });
    expect(await prisma.message.findUniqueOrThrow({ where: { id: sent.body.message.id } })).toMatchObject({
      content: 'Mine',
      editedAt: null,
    });
  });

  it('returns 404 for a message that does not exist or was deleted, and never revives a deleted one', async () => {
    const user = await createUser('Alice');
    const room = await createGroupRoom(user.id);
    const agent = await loginAs(user);
    const sent = await agent.post(`/chat/${room.id}/message`).send({ content: 'Once' });
    await agent.delete(messageUrl(room.id, sent.body.message.id));

    const noSuchMessage = await agent.patch(messageUrl(room.id, 999_999)).send({ content: 'Hi' });
    const deleted = await agent.patch(messageUrl(room.id, sent.body.message.id)).send({ content: 'Back' });

    for (const res of [noSuchMessage, deleted]) {
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ message: 'Message not found in this chat room' });
    }
    expect(await prisma.message.findUniqueOrThrow({ where: { id: sent.body.message.id } })).toMatchObject({
      content: '',
      editedAt: null,
    });
  });

  it('returns 404 for a message id that belongs to a different chat room', async () => {
    const user = await createUser('Alice');
    const roomA = await createGroupRoom(user.id, [], 'Room A');
    const roomB = await createGroupRoom(user.id, [], 'Room B');
    const agent = await loginAs(user);
    const sent = await agent.post(`/chat/${roomA.id}/message`).send({ content: 'In room A' });

    const res = await agent.patch(messageUrl(roomB.id, sent.body.message.id)).send({ content: 'Moved' });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Message not found in this chat room' });
    expect(
      (await prisma.message.findUniqueOrThrow({ where: { id: sent.body.message.id } })).content
    ).toBe('In room A');
  });

  it('rejects a blank content with 400 and leaves the message untouched', async () => {
    const user = await createUser('Alice');
    const room = await createGroupRoom(user.id);
    const agent = await loginAs(user);
    const sent = await agent.post(`/chat/${room.id}/message`).send({ content: 'Keep me' });

    const res = await agent.patch(messageUrl(room.id, sent.body.message.id)).send({ content: '   ' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ message: "'content' must be a non-empty string" });
    expect(
      (await prisma.message.findUniqueOrThrow({ where: { id: sent.body.message.id } })).content
    ).toBe('Keep me');
  });
});

describe('editMessage (service)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not write into a message that was deleted after it was read', async () => {
    const user = await createUser('Alice');
    const room = await createGroupRoom(user.id);
    const message = await prisma.message.create({
      data: { chatId: room.id, senderId: user.id, content: 'Original' },
      include: { sender: { select: { id: true, name: true, avatarUrl: true } } },
    });
    // The row is deleted, but the service's first read still sees the live
    // one - the window between "check" and "write" that a second tab (or a
    // second request) can slip into.
    await prisma.message.update({ where: { id: message.id }, data: { deletedAt: new Date(), content: '' } });
    vi.spyOn(prisma.message, 'findUnique').mockResolvedValueOnce(message as never);

    const result = await editMessage(room.id, message.id, user.id, 'Revived?');

    expect(result).toEqual({ status: 'not_found' });
    expect(await prisma.message.findUniqueOrThrow({ where: { id: message.id } })).toMatchObject({
      content: '',
      editedAt: null,
    });
  });
});
