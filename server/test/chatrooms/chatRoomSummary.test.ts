import { describe, expect, it } from 'vitest';
import { prisma } from '../../src/lib/prisma';
import { createUser, loginAs, type TestAgent } from '../helpers/users';
import { createDirectRoom, createGroupRoom } from '../helpers/chatRooms';

// The two message-related fields of a room summary, as GET /chat and
// GET /chat/:chatid return them: `lastMessage` (the newest message that has
// not been deleted) and `unreadCount`. The rest of the summary (names, avatars,
// the order of the list) is in chatRoom.test.ts.

async function addMessage(chatId: number, senderId: number | null, content = 'Hello', createdAt?: Date) {
  return prisma.message.create({
    data: { chatId, senderId, content, ...(createdAt ? { createdAt } : {}) },
  });
}

async function setMarker(chatId: number, memberId: number, lastReadMessageId: number | null) {
  await prisma.chatMember.update({
    where: { memberId_chatId: { memberId, chatId } },
    data: { lastReadMessageId },
  });
}

/** The summary of one room as the list returns it and as the single-room route returns it. */
async function summariesOf(agent: TestAgent, chatId: number) {
  const list = await agent.get('/chat');
  const single = await agent.get(`/chat/${chatId}`);

  expect(list.status).toBe(200);
  expect(single.status).toBe(200);

  return {
    inList: list.body.chatRooms.find((room: { id: number }) => room.id === chatId),
    single: single.body.chatRoom,
  };
}

describe('lastMessage in the room summaries', () => {
  // Direct and group rooms are loaded by two separate functions, so both are covered.
  it.each([
    ['group', (aliceId: number, bobId: number) => createGroupRoom(aliceId, [bobId])],
    ['direct', (aliceId: number, bobId: number) => createDirectRoom(aliceId, bobId)],
  ])('skips deleted messages in a %s room, so the preview shows the message before a deleted one', async (_type, createRoom) => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');
    const room = await createRoom(alice.id, bob.id);
    const agent = await loginAs(alice);
    await agent.post(`/chat/${room.id}/message`).send({ content: 'Earlier' });
    const latest = await agent.post(`/chat/${room.id}/message`).send({ content: 'Oops' });
    await agent.delete(`/chat/${room.id}/message/${latest.body.message.id}`);

    const { inList, single } = await summariesOf(await loginAs(bob), room.id);

    for (const summary of [inList, single]) {
      expect(summary.lastMessage).toMatchObject({ content: 'Earlier' });
    }
  });

  it('is null when every message was deleted, and the room is then ordered by when it was created', async () => {
    const alice = await createUser('Alice');
    const agent = await loginAs(alice);
    // Created first, but its (deleted) message is the newest thing anywhere...
    const emptiedRoom = await createGroupRoom(alice.id, [], 'Emptied');
    await prisma.chatRoom.update({
      where: { id: emptiedRoom.id },
      data: { createdAt: new Date('2026-09-13T10:00:00.000Z') },
    });
    await prisma.message.create({
      data: {
        chatId: emptiedRoom.id,
        senderId: alice.id,
        content: '',
        deletedAt: new Date('2026-09-13T15:00:00.000Z'),
        createdAt: new Date('2026-09-13T14:00:00.000Z'),
      },
    });
    // ...but a deleted message is not activity, so this room (created later, no messages) wins.
    const quietRoom = await createGroupRoom(alice.id, [], 'Quiet');
    await prisma.chatRoom.update({
      where: { id: quietRoom.id },
      data: { createdAt: new Date('2026-09-13T12:00:00.000Z') },
    });

    const list = await agent.get('/chat');
    const single = await agent.get(`/chat/${emptiedRoom.id}`);

    expect(list.body.chatRooms.map((room: { id: number }) => room.id)).toEqual([quietRoom.id, emptiedRoom.id]);
    expect(list.body.chatRooms[1].lastMessage).toBeNull();
    expect(single.body.chatRoom.lastMessage).toBeNull();
  });
});

describe('unreadCount in the room summaries', () => {
  it('counts the messages above the requester\'s marker, leaving out their own, deleted ones and anything at or below the marker', async () => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');
    const room = await createGroupRoom(alice.id, [bob.id]);
    const read = await addMessage(room.id, bob.id, 'Read already');
    await addMessage(room.id, alice.id, 'My own message');
    await addMessage(room.id, bob.id, 'Unread one');
    await prisma.message.create({
      data: { chatId: room.id, senderId: bob.id, content: '', deletedAt: new Date() },
    });
    await addMessage(room.id, bob.id, 'Unread two');
    await setMarker(room.id, alice.id, read.id);

    const { inList, single } = await summariesOf(await loginAs(alice), room.id);

    expect(inList.unreadCount).toBe(2);
    expect(single.unreadCount).toBe(2);
  });

  it('counts every message from other people while the marker is still empty, and is 0 for a room without messages', async () => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');
    const busyRoom = await createGroupRoom(alice.id, [bob.id], 'Busy');
    const emptyRoom = await createGroupRoom(alice.id, [bob.id], 'Empty');
    await addMessage(busyRoom.id, bob.id);
    await addMessage(busyRoom.id, bob.id);
    await addMessage(busyRoom.id, alice.id);
    const agent = await loginAs(alice);

    const busy = await summariesOf(agent, busyRoom.id);
    const empty = await summariesOf(agent, emptyRoom.id);

    expect(busy.inList.unreadCount).toBe(2);
    expect(busy.single.unreadCount).toBe(2);
    expect(empty.inList.unreadCount).toBe(0);
    expect(empty.single.unreadCount).toBe(0);
  });

  it('counts each room against its own marker, in direct and group rooms alike, and ignores the other members\' markers', async () => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');
    const carol = await createUser('Carol');
    const direct = await createDirectRoom(alice.id, bob.id);
    const group = await createGroupRoom(alice.id, [bob.id, carol.id]);
    const directFirst = await addMessage(direct.id, bob.id, 'Direct 1');
    await addMessage(direct.id, bob.id, 'Direct 2');
    await addMessage(direct.id, bob.id, 'Direct 3');
    await addMessage(group.id, carol.id, 'Group 1');
    const groupSecond = await addMessage(group.id, carol.id, 'Group 2');
    await setMarker(direct.id, alice.id, directFirst.id);
    // Bob has read everything in the group and Carol nothing; neither matters to Alice.
    await setMarker(group.id, bob.id, groupSecond.id);
    await setMarker(group.id, alice.id, null);

    const res = await (await loginAs(alice)).get('/chat');

    const unreadByRoom = Object.fromEntries(
      res.body.chatRooms.map((room: { id: number; unreadCount: number }) => [room.id, room.unreadCount])
    );
    expect(unreadByRoom).toEqual({ [direct.id]: 2, [group.id]: 2 });
  });

  it('counts a message whose author has deleted their account, because it is still somebody else\'s message', async () => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');
    const room = await createGroupRoom(alice.id, [bob.id]);
    await addMessage(room.id, bob.id, 'From someone who left');
    await prisma.user.delete({ where: { id: bob.id } });
    expect(await prisma.message.count({ where: { chatId: room.id, senderId: null } })).toBe(1);

    const { inList, single } = await summariesOf(await loginAs(alice), room.id);

    expect(inList.unreadCount).toBe(1);
    expect(single.unreadCount).toBe(1);
  });

  it('follows PUT /chat/:chatid/read and new messages, and one member reading does not change another\'s count', async () => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');
    const room = await createGroupRoom(alice.id, [bob.id]);
    await addMessage(room.id, alice.id, 'One');
    const second = await addMessage(room.id, alice.id, 'Two');
    const aliceAgent = await loginAs(alice);
    const bobAgent = await loginAs(bob);

    expect((await summariesOf(bobAgent, room.id)).single.unreadCount).toBe(2);

    await bobAgent.put(`/chat/${room.id}/read`).send({ message_id: second.id });
    expect((await summariesOf(bobAgent, room.id)).single.unreadCount).toBe(0);

    await aliceAgent.post(`/chat/${room.id}/message`).send({ content: 'Three' });
    expect((await summariesOf(bobAgent, room.id)).single.unreadCount).toBe(1);
    // Alice only ever sent messages, so nothing is unread for her whatever Bob has read.
    expect((await summariesOf(aliceAgent, room.id)).single.unreadCount).toBe(0);
  });

  it('does not count deleted messages even when they sit above the marker, nor messages of other rooms', async () => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');
    const room = await createGroupRoom(alice.id, [bob.id], 'This one');
    const otherRoom = await createGroupRoom(alice.id, [bob.id], 'Another one');
    const bobAgent = await loginAs(bob);
    const sent = await (await loginAs(alice))
      .post(`/chat/${room.id}/message`)
      .send({ content: 'Soon gone' });
    await addMessage(otherRoom.id, alice.id, 'Somewhere else');
    expect((await summariesOf(bobAgent, room.id)).single.unreadCount).toBe(1);

    await (await loginAs(alice)).delete(`/chat/${room.id}/message/${sent.body.message.id}`);

    expect((await summariesOf(bobAgent, room.id)).single.unreadCount).toBe(0);
  });
});
