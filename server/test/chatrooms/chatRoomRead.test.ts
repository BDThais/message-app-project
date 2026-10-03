import { describe, expect, it } from 'vitest';
import { prisma } from '../../src/lib/prisma';
import { createUser, loginAs } from '../helpers/users';
import { createDirectRoom, createGroupRoom } from '../helpers/chatRooms';
import { markChatRoomRead } from '../../src/modules/chatrooms/chatMember.service';

// The session/membership guard on this route is covered once for every route
// in chatRoom.permissions.test.ts; the full list of bad bodies is in
// chatRoom.validator.unit.test.ts.

async function addMessage(chatId: number, senderId: number, content = 'Hello') {
  return prisma.message.create({ data: { chatId, senderId, content } });
}

async function markerOf(chatId: number, memberId: number) {
  const row = await prisma.chatMember.findUniqueOrThrow({
    where: { memberId_chatId: { memberId, chatId } },
  });
  return row.lastReadMessageId;
}

describe('PUT /chat/:chatid/read', () => {
  it('sets the requester\'s marker, returns it, and leaves the other members\' markers alone', async () => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');
    const room = await createGroupRoom(alice.id, [bob.id]);
    await addMessage(room.id, alice.id, 'First');
    const second = await addMessage(room.id, alice.id, 'Second');
    const agent = await loginAs(bob);

    const res = await agent.put(`/chat/${room.id}/read`).send({ message_id: second.id });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ lastReadMessageId: second.id });
    expect(await markerOf(room.id, bob.id)).toBe(second.id);
    expect(await markerOf(room.id, alice.id)).toBeNull();
  });

  it('only moves the marker forward: an earlier or equal message changes nothing and still answers 200', async () => {
    const alice = await createUser('Alice');
    const room = await createGroupRoom(alice.id);
    const first = await addMessage(room.id, alice.id, 'First');
    const second = await addMessage(room.id, alice.id, 'Second');
    const agent = await loginAs(alice);
    await agent.put(`/chat/${room.id}/read`).send({ message_id: second.id });

    for (const messageId of [first.id, second.id]) {
      const res = await agent.put(`/chat/${room.id}/read`).send({ message_id: messageId });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ lastReadMessageId: second.id });
    }
    expect(await markerOf(room.id, alice.id)).toBe(second.id);
  });

  it('ends at the highest message when many requests race each other', async () => {
    // Calls the service directly: that is where the single conditional
    // update lives, and a read-then-write version fails here every time.
    const alice = await createUser('Alice');
    const room = await createGroupRoom(alice.id);
    const messageIds: number[] = [];
    for (let i = 0; i < 40; i++) {
      messageIds.push((await addMessage(room.id, alice.id)).id);
    }
    const inRandomOrder = [...messageIds].sort(() => Math.random() - 0.5);

    await Promise.all(inRandomOrder.map((id) => markChatRoomRead(room.id, alice.id, id)));

    expect(await markerOf(room.id, alice.id)).toBe(Math.max(...messageIds));
  });

  it('accepts a soft-deleted message', async () => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');
    const room = await createGroupRoom(alice.id, [bob.id]);
    const message = await addMessage(room.id, alice.id);
    await (await loginAs(alice)).delete(`/chat/${room.id}/message/${message.id}`).expect(204);
    const agent = await loginAs(bob);

    const res = await agent.put(`/chat/${room.id}/read`).send({ message_id: message.id });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ lastReadMessageId: message.id });
  });

  it('answers 404 for a message that is not in this room, and changes nothing', async () => {
    const alice = await createUser('Alice');
    const room = await createGroupRoom(alice.id);
    const otherRoom = await createGroupRoom(alice.id, [], 'Other chat');
    const elsewhere = await addMessage(otherRoom.id, alice.id);
    const agent = await loginAs(alice);

    // A message of another room, and an id that does not exist at all.
    for (const messageId of [elsewhere.id, elsewhere.id + 1000]) {
      const res = await agent.put(`/chat/${room.id}/read`).send({ message_id: messageId });

      expect(res.status, String(messageId)).toBe(404);
      expect(res.body).toEqual({ error: 'Message not found in this chat room' });
    }
    expect(await markerOf(room.id, alice.id)).toBeNull();
    expect(await markerOf(otherRoom.id, alice.id)).toBeNull();
  });

  it('lets either member of a direct room mark it as read', async () => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');
    const room = await createDirectRoom(alice.id, bob.id);
    const message = await addMessage(room.id, alice.id);
    const agent = await loginAs(bob);

    const res = await agent.put(`/chat/${room.id}/read`).send({ message_id: message.id });

    expect(res.status).toBe(200);
    expect(await markerOf(room.id, bob.id)).toBe(message.id);
  });

  it('rejects a body without a valid message_id with 400', async () => {
    const alice = await createUser('Alice');
    const room = await createGroupRoom(alice.id);
    const agent = await loginAs(alice);

    const res = await agent.put(`/chat/${room.id}/read`).send({});

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "'message_id' must be a positive integer message id" });
  });
});
