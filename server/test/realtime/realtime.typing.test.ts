import { describe, expect, it } from 'vitest';
import { createGroupRoom } from '../helpers/chatRooms';
import { connectSocket, eventually, openSession, payloadsOf, settle, useRealtimeServer } from '../helpers/realtime';
import { createUser } from '../helpers/users';

useRealtimeServer();

describe('typing', () => {
  it('relays typing to the other sockets of the room, with who is typing, and not back to the socket that sent it', async () => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');
    const room = await createGroupRoom(alice.id, [bob.id]);
    const aliceSocket = await connectSocket((await openSession(alice)).cookie);
    const aliceOtherTab = await connectSocket((await openSession(alice)).cookie);
    const bobSocket = await connectSocket((await openSession(bob)).cookie);

    aliceSocket.emit('typing', { chatId: room.id });

    const expected = [{ chatId: room.id, user: { id: alice.id, name: 'Alice', avatarUrl: null } }];
    await eventually(() => expect(payloadsOf(bobSocket, 'typing')).toEqual(expected));
    await eventually(() => expect(payloadsOf(aliceOtherTab, 'typing')).toEqual(expected));
    await settle();
    expect(aliceSocket.received).toEqual([]);
  });

  it('does not relay typing for a room the sender is not in, or for a chat id that is not a whole number', async () => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');
    const carl = await createUser('Carl');
    const room = await createGroupRoom(bob.id, [carl.id]);
    const aliceSocket = await connectSocket((await openSession(alice)).cookie);
    const bobSocket = await connectSocket((await openSession(bob)).cookie);

    aliceSocket.emit('typing', { chatId: room.id });
    for (const payload of [null, undefined, 'x', {}, { chatId: '1' }, { chatId: 1.5 }, { chatId: { toString: 'x' } }]) {
      (aliceSocket as { emit: (event: string, payload: unknown) => void }).emit('typing', payload);
    }

    await settle();
    expect(bobSocket.received).toEqual([]);
  });

  it('relays at most one typing a second for a room from one socket', async () => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');
    const room = await createGroupRoom(alice.id, [bob.id]);
    const aliceSocket = await connectSocket((await openSession(alice)).cookie);
    const bobSocket = await connectSocket((await openSession(bob)).cookie);

    for (let i = 0; i < 20; i++) aliceSocket.emit('typing', { chatId: room.id });

    await eventually(() => expect(payloadsOf(bobSocket, 'typing')).toHaveLength(1));
    await settle();
    expect(payloadsOf(bobSocket, 'typing')).toHaveLength(1);
  });
});
