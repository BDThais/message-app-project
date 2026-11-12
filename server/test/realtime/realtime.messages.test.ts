import { describe, expect, it } from 'vitest';
import { prisma } from '../../src/lib/prisma';
import { createGroupRoom } from '../helpers/chatRooms';
import { connectSocket, eventually, openSession, payloadsOf, settle, useRealtimeServer } from '../helpers/realtime';
import { createUser } from '../helpers/users';

useRealtimeServer();

// Three people, a room of two of them, and a socket each (Alice has a second one: another tab).
async function setup() {
  const alice = await createUser('Alice');
  const bob = await createUser('Bob');
  const carl = await createUser('Carl');
  const room = await createGroupRoom(alice.id, [bob.id]);
  const [a, b, c] = await Promise.all([openSession(alice), openSession(bob), openSession(carl)]);
  const aliceTab = await connectSocket(a.cookie);
  const aliceOtherTab = await connectSocket((await openSession(alice)).cookie);
  const bobSocket = await connectSocket(b.cookie);
  const carlSocket = await connectSocket(c.cookie);
  return { alice, bob, room, a, b, aliceTab, aliceOtherTab, bobSocket, carlSocket };
}

describe('message events', () => {
  it('sends message:new to every socket in the room, the sender`s own included, and to nobody else', async () => {
    const { room, a, aliceTab, aliceOtherTab, bobSocket, carlSocket } = await setup();

    const res = await a.agent.post(`/api/chat/${room.id}/message`).send({ content: 'Hello' });

    expect(res.status).toBe(201);
    for (const socket of [aliceTab, aliceOtherTab, bobSocket]) {
      await eventually(() => expect(payloadsOf(socket, 'message:new')).toEqual([{ message: res.body.message }]));
    }
    await settle();
    expect(carlSocket.received).toEqual([]);
  });

  it('sends nothing for a message that was refused', async () => {
    const { room, a, bobSocket } = await setup();

    const res = await a.agent.post(`/api/chat/${room.id}/message`).send({ content: '   ' });

    expect(res.status).toBe(400);
    await settle();
    expect(bobSocket.received).toEqual([]);
  });

  it('sends message:updated with the message PATCH answered with, and nothing for an edit that changed nothing', async () => {
    const { room, a, bobSocket } = await setup();
    const sent = await a.agent.post(`/api/chat/${room.id}/message`).send({ content: 'Hello' });
    const id = sent.body.message.id;
    await eventually(() => expect(payloadsOf(bobSocket, 'message:new')).toHaveLength(1));

    const same = await a.agent.patch(`/api/chat/${room.id}/message/${id}`).send({ content: 'Hello' });
    await settle();
    expect(payloadsOf(bobSocket, 'message:updated')).toEqual([]);

    const edited = await a.agent.patch(`/api/chat/${room.id}/message/${id}`).send({ content: 'Hello again' });

    expect(same.status).toBe(200);
    expect(edited.body.message.editedAt).not.toBeNull();
    await eventually(() =>
      expect(payloadsOf(bobSocket, 'message:updated')).toEqual([{ message: edited.body.message }]),
    );
  });

  it('sends message:deleted with the stamp that was written', async () => {
    const { room, a, aliceOtherTab } = await setup();
    const sent = await a.agent.post(`/api/chat/${room.id}/message`).send({ content: 'Oops' });
    const id: number = sent.body.message.id;

    const res = await a.agent.delete(`/api/chat/${room.id}/message/${id}`);

    expect(res.status).toBe(204);
    const stored = await prisma.message.findUniqueOrThrow({ where: { id } });
    await eventually(() =>
      expect(payloadsOf(aliceOtherTab, 'message:deleted')).toEqual([
        { chatId: room.id, messageId: id, deletedAt: stored.deletedAt!.toISOString() },
      ]),
    );
  });

  it('sends nothing for a message somebody else wrote, or one that is not there', async () => {
    const { room, a, b, bobSocket } = await setup();
    const sent = await a.agent.post(`/api/chat/${room.id}/message`).send({ content: 'Mine' });
    await eventually(() => expect(payloadsOf(bobSocket, 'message:new')).toHaveLength(1));

    const notYours = await b.agent.delete(`/api/chat/${room.id}/message/${sent.body.message.id}`);
    const missing = await b.agent.delete(`/api/chat/${room.id}/message/999999`);
    const editNotYours = await b.agent
      .patch(`/api/chat/${room.id}/message/${sent.body.message.id}`)
      .send({ content: 'x' });

    expect([notYours.status, missing.status, editNotYours.status]).toEqual([403, 404, 403]);
    await settle();
    expect(payloadsOf(bobSocket, 'message:deleted')).toEqual([]);
    expect(payloadsOf(bobSocket, 'message:updated')).toEqual([]);
  });

  it('sends read:updated to the room when the marker moves, and not when the call changes nothing', async () => {
    const { room, a, b, aliceTab, bobSocket } = await setup();
    const sent = await a.agent.post(`/api/chat/${room.id}/message`).send({ content: 'Read me' });
    const id: number = sent.body.message.id;
    await eventually(() => expect(payloadsOf(bobSocket, 'message:new')).toHaveLength(1));

    await b.agent.put(`/api/chat/${room.id}/read`).send({ message_id: id }).expect(200);
    await eventually(() => expect(payloadsOf(aliceTab, 'read:updated')).toHaveLength(1));
    await b.agent.put(`/api/chat/${room.id}/read`).send({ message_id: id }).expect(200);
    await settle();

    const [bob] = await prisma.user.findMany({ where: { name: 'Bob' } });
    expect(payloadsOf(aliceTab, 'read:updated')).toEqual([{ chatId: room.id, userId: bob!.id, lastReadMessageId: id }]);
  });
});
