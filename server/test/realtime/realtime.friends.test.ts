import { describe, expect, it } from 'vitest';
import { createFriendRequest } from '../helpers/friends';
import { connectSocket, eventually, openSession, payloadsOf, settle, useRealtimeServer } from '../helpers/realtime';
import { createUser } from '../helpers/users';

useRealtimeServer();

describe('friend events', () => {
  it("sends friend:request to every socket of the receiver, with the request as the receiver's own list shows it", async () => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');
    const a = await openSession(alice);
    const aliceSocket = await connectSocket(a.cookie);
    const bobSocket = await connectSocket((await openSession(bob)).cookie);
    const bobOtherTab = await connectSocket((await openSession(bob)).cookie);

    const res = await a.agent.post('/api/friend/requests').send({ receiver_id: bob.id });

    expect(res.status).toBe(201);
    const expected = [
      {
        request: {
          id: res.body.request.id,
          createdAt: res.body.request.createdAt,
          user: { id: alice.id, name: 'Alice', avatarUrl: null },
        },
      },
    ];
    for (const socket of [bobSocket, bobOtherTab]) {
      await eventually(() => expect(payloadsOf(socket, 'friend:request')).toEqual(expected));
    }
    await settle();
    expect(aliceSocket.received).toEqual([]);
  });

  it('sends nothing for a request that was refused', async () => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');
    await createFriendRequest(alice.id, bob.id);
    const a = await openSession(alice);
    const bobSocket = await connectSocket((await openSession(bob)).cookie);

    await a.agent.post('/api/friend/requests').send({ receiver_id: bob.id }).expect(409);

    await settle();
    expect(bobSocket.received).toEqual([]);
  });

  it('sends friend:accepted to the one who sent the request, with the person who accepted, and not to the accepter', async () => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');
    const request = await createFriendRequest(alice.id, bob.id);
    const aliceSocket = await connectSocket((await openSession(alice)).cookie);
    const b = await openSession(bob);
    const bobSocket = await connectSocket(b.cookie);

    await b.agent.post(`/api/friend/requests/${request.id}/accept`).expect(201);

    await eventually(() =>
      expect(payloadsOf(aliceSocket, 'friend:accepted')).toEqual([
        { friend: { id: bob.id, name: 'Bob', avatarUrl: null } },
      ]),
    );
    await settle();
    expect(bobSocket.received).toEqual([]);
  });

  it('sends nothing when the request to accept is not there', async () => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');
    const aliceSocket = await connectSocket((await openSession(alice)).cookie);
    const b = await openSession(bob);

    await b.agent.post('/api/friend/requests/999999/accept').expect(404);

    await settle();
    expect(aliceSocket.received).toEqual([]);
  });
});
