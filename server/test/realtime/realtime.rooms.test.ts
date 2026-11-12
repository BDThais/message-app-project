import { describe, expect, it } from 'vitest';
import { createDirectRoom, createGroupRoom, promoteToAdmin } from '../helpers/chatRooms';
import { makeFriends } from '../helpers/friends';
import { connectSocket, eventually, openSession, payloadsOf, settle, useRealtimeServer } from '../helpers/realtime';
import { createUser } from '../helpers/users';

const realtime = useRealtimeServer();

const roomsOf = async (userId: number) => {
  const sockets = await realtime.io().in(`user:${userId}`).fetchSockets();
  return sockets.flatMap((socket) => [...socket.rooms].filter((room) => room.startsWith('chat:'))).sort();
};

describe('room events', () => {
  it('puts the sockets of the people a group is made with into its room, and tells the room', async () => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');
    await makeFriends(alice.id, bob.id);
    const a = await openSession(alice);
    const b = await openSession(bob);
    const aliceTab = await connectSocket(a.cookie);
    const bobSocket = await connectSocket(b.cookie);

    const res = await a.agent.post('/api/chat').send({ type: 'group', member_ids: [bob.id], name: 'Team' });

    expect(res.status).toBe(201);
    const chatId: number = res.body.chatRoom.id;
    for (const socket of [aliceTab, bobSocket]) {
      await eventually(() =>
        expect(payloadsOf(socket, 'member:added')).toEqual([{ chatId, userIds: [alice.id, bob.id].sort() }]),
      );
    }
    // From then on the room's events reach Bob, who had no room when he connected.
    await a.agent.post(`/api/chat/${chatId}/message`).send({ content: 'Welcome' }).expect(201);
    await eventually(() => expect(payloadsOf(bobSocket, 'message:new')).toHaveLength(1));
  });

  it('tells nobody about a direct room that already existed', async () => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');
    await makeFriends(alice.id, bob.id);
    await createDirectRoom(alice.id, bob.id);
    const a = await openSession(alice);
    const bobSocket = await connectSocket((await openSession(bob)).cookie);

    const res = await a.agent.post('/api/chat').send({ type: 'direct', member_ids: [bob.id] });

    expect(res.status).toBe(200);
    await settle();
    expect(bobSocket.received).toEqual([]);
  });

  it('puts the socket of a person added to a room into it, and tells the whole room, the new member included', async () => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');
    const carl = await createUser('Carl');
    await makeFriends(alice.id, carl.id);
    const room = await createGroupRoom(alice.id, [bob.id]);
    const a = await openSession(alice);
    const bobSocket = await connectSocket((await openSession(bob)).cookie);
    const carlSocket = await connectSocket((await openSession(carl)).cookie);
    expect(await roomsOf(carl.id)).toEqual([]);

    const res = await a.agent.post(`/api/chat/${room.id}/member`).send({ member_ids: [carl.id] });

    expect(res.status).toBe(201);
    for (const socket of [bobSocket, carlSocket]) {
      await eventually(() =>
        expect(payloadsOf(socket, 'member:added')).toEqual([{ chatId: room.id, userIds: [carl.id] }]),
      );
    }
    expect(await roomsOf(carl.id)).toEqual([`chat:${room.id}`]);
  });

  it('tells nobody when the people to add were all members already', async () => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');
    await makeFriends(alice.id, bob.id);
    const room = await createGroupRoom(alice.id, [bob.id]);
    const a = await openSession(alice);
    const bobSocket = await connectSocket((await openSession(bob)).cookie);

    const res = await a.agent.post(`/api/chat/${room.id}/member`).send({ member_ids: [bob.id] });

    expect(res.status).toBe(200);
    await settle();
    expect(bobSocket.received).toEqual([]);
  });

  it('takes a removed member out of the room: they are told it is gone, the others who left, and they hear no more', async () => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');
    const carl = await createUser('Carl');
    const room = await createGroupRoom(alice.id, [bob.id, carl.id]);
    const a = await openSession(alice);
    const aliceTab = await connectSocket(a.cookie);
    const bobSocket = await connectSocket((await openSession(bob)).cookie);
    const bobOtherTab = await connectSocket((await openSession(bob)).cookie);
    const carlSocket = await connectSocket((await openSession(carl)).cookie);

    await a.agent.delete(`/api/chat/${room.id}/member/${bob.id}`).expect(204);

    for (const socket of [bobSocket, bobOtherTab]) {
      await eventually(() => expect(payloadsOf(socket, 'chat:removed')).toEqual([{ chatId: room.id }]));
      expect(payloadsOf(socket, 'member:removed')).toEqual([]);
    }
    for (const socket of [aliceTab, carlSocket]) {
      await eventually(() =>
        expect(payloadsOf(socket, 'member:removed')).toEqual([{ chatId: room.id, userId: bob.id }]),
      );
    }
    await a.agent.post(`/api/chat/${room.id}/message`).send({ content: 'Without Bob' }).expect(201);
    await eventually(() => expect(payloadsOf(carlSocket, 'message:new')).toHaveLength(1));
    await settle();
    expect(payloadsOf(bobSocket, 'message:new')).toEqual([]);
    expect(await roomsOf(bob.id)).toEqual([]);
  });

  it('does the same for a member who leaves', async () => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');
    const room = await createGroupRoom(alice.id, [bob.id]);
    const aliceTab = await connectSocket((await openSession(alice)).cookie);
    const b = await openSession(bob);
    const bobSocket = await connectSocket(b.cookie);

    await b.agent.delete(`/api/chat/${room.id}/member/${bob.id}`).expect(204);

    await eventually(() => expect(payloadsOf(bobSocket, 'chat:removed')).toEqual([{ chatId: room.id }]));
    await eventually(() =>
      expect(payloadsOf(aliceTab, 'member:removed')).toEqual([{ chatId: room.id, userId: bob.id }]),
    );
    expect(await roomsOf(bob.id)).toEqual([]);
  });

  it('sends nothing when the removal was refused (the only admin cannot go)', async () => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');
    const room = await createGroupRoom(alice.id, [bob.id]);
    const a = await openSession(alice);
    const bobSocket = await connectSocket((await openSession(bob)).cookie);

    await a.agent.delete(`/api/chat/${room.id}/member/${alice.id}`).expect(409);

    await settle();
    expect(bobSocket.received).toEqual([]);
  });

  it('sends member:role_changed to the room', async () => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');
    const room = await createGroupRoom(alice.id, [bob.id]);
    const a = await openSession(alice);
    const bobSocket = await connectSocket((await openSession(bob)).cookie);

    await a.agent.patch(`/api/chat/${room.id}/member/${bob.id}`).send({ role: 'admin' }).expect(200);

    await eventually(() =>
      expect(payloadsOf(bobSocket, 'member:role_changed')).toEqual([
        { chatId: room.id, userId: bob.id, role: 'admin' },
      ]),
    );
  });

  it("sends chat:updated with the group's new name and avatar, one name for every member", async () => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');
    const room = await createGroupRoom(alice.id, [bob.id]);
    await promoteToAdmin(room.id, alice.id);
    const a = await openSession(alice);
    const bobSocket = await connectSocket((await openSession(bob)).cookie);

    await a.agent.patch(`/api/chat/${room.id}`).send({ name: 'Renamed' }).expect(200);

    await eventually(() =>
      expect(payloadsOf(bobSocket, 'chat:updated')).toEqual([{ chatId: room.id, name: 'Renamed', avatarUrl: null }]),
    );
  });

  it('tells everybody a deleted room is gone, and empties its socket room', async () => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');
    const room = await createGroupRoom(alice.id, [bob.id]);
    const a = await openSession(alice);
    const aliceTab = await connectSocket(a.cookie);
    const bobSocket = await connectSocket((await openSession(bob)).cookie);

    await a.agent.delete(`/api/chat/${room.id}`).expect(204);

    for (const socket of [aliceTab, bobSocket]) {
      await eventually(() => expect(payloadsOf(socket, 'chat:removed')).toEqual([{ chatId: room.id }]));
    }
    expect(await roomsOf(alice.id)).toEqual([]);
    expect(await roomsOf(bob.id)).toEqual([]);
  });
});
