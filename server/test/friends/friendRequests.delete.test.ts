import { describe, expect, it } from 'vitest';
import { prisma } from '../../src/lib/prisma';
import { createUser, loginAs } from '../helpers/users';
import { createFriendRequest } from '../helpers/friends';

// The session guard on this route is covered once for every friend route in
// friend.permissions.test.ts; the full list of bad `:id` values is in
// friend.validator.unit.test.ts.

const deleteUrl = (requestId: number) => `/friend/requests/${requestId}`;

// Every pending request as [senderId, receiverId], in a fixed order.
async function requestPairs() {
  const rows = await prisma.pendingFriendRequest.findMany({
    orderBy: [{ senderId: 'asc' }, { receiverId: 'asc' }],
  });

  return rows.map((row) => [row.senderId, row.receiverId]);
}

describe('DELETE /friend/requests/:id', () => {
  // Rejecting and cancelling are the same call: either party of the request
  // can delete it.
  it.each([
    ['the receiver rejects', 'bob'],
    ['the sender cancels', 'alice'],
  ] as const)('%s: deletes that request, answers 204 with no body and leaves every other request alone', async (_label, caller) => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');
    const carol = await createUser('Carol');
    // Alice -> Bob is the request under test. Bob -> Alice is the other half of
    // the send-at-the-same-instant race: a different request, so it stays (that
    // is why `:id` is a request ID and not a user ID).
    const aliceToBob = await createFriendRequest(alice.id, bob.id);
    await createFriendRequest(bob.id, alice.id);
    await createFriendRequest(carol.id, bob.id);
    await createFriendRequest(alice.id, carol.id);
    const agent = await loginAs(caller === 'alice' ? alice : bob);

    const res = await agent.delete(deleteUrl(aliceToBob.id));

    expect(res.status).toBe(204);
    expect(res.text).toBe('');
    expect(await requestPairs()).toEqual([
      [alice.id, carol.id],
      [bob.id, alice.id],
      [carol.id, bob.id],
    ]);
    // Deleting a request never makes anyone a friend.
    expect(await prisma.friendListMember.count()).toBe(0);
  });

  it('answers 404 when the request does not exist or is between two other users, changing nothing', async () => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');
    const carol = await createUser('Carol');
    const betweenOthers = await createFriendRequest(bob.id, carol.id);
    const agent = await loginAs(alice);

    const someoneElses = await agent.delete(deleteUrl(betweenOthers.id));
    const missing = await agent.delete(deleteUrl(betweenOthers.id + 1000));

    // The two get the same answer, so nobody can probe other users' requests.
    for (const res of [someoneElses, missing]) {
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'Friend request not found' });
    }
    expect(await requestPairs()).toEqual([[bob.id, carol.id]]);
  });

  it('leaves no trace: the same user can send a new request after a rejection', async () => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');
    const pending = await createFriendRequest(bob.id, alice.id);
    const aliceAgent = await loginAs(alice);
    const bobAgent = await loginAs(bob);

    const rejected = await aliceAgent.delete(deleteUrl(pending.id));
    const again = await bobAgent.post('/friend/requests').send({ receiver_id: alice.id });

    expect(rejected.status).toBe(204);
    expect(again.status).toBe(201);
    expect(await requestPairs()).toEqual([[bob.id, alice.id]]);
  });

  it('rejects an :id that is not a valid ID with 400, changing nothing', async () => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');
    await createFriendRequest(bob.id, alice.id);
    const agent = await loginAs(alice);

    const res = await agent.delete('/friend/requests/abc');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid friend request id' });
    expect(await requestPairs()).toEqual([[bob.id, alice.id]]);
  });

  it('lets a double click or a second tab delete twice at once: one 204, one 404, never a 5xx', async () => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');
    const pending = await createFriendRequest(bob.id, alice.id);
    const agent = await loginAs(alice);

    // The permission check and the delete are one statement, so the call that
    // runs second always finds nothing left to delete.
    const responses = await Promise.all([agent.delete(deleteUrl(pending.id)), agent.delete(deleteUrl(pending.id))]);

    expect(responses.map((r) => r.status).sort()).toEqual([204, 404]);
    expect(await requestPairs()).toEqual([]);
  });

  it('lets the sender cancel while the receiver rejects: one 204, one 404, never a 5xx', async () => {
    // A few rounds, because whether the two statements overlap is a matter of timing.
    for (let round = 0; round < 5; round++) {
      const alice = await createUser('Alice');
      const bob = await createUser('Bob');
      const pending = await createFriendRequest(alice.id, bob.id);
      const aliceAgent = await loginAs(alice);
      const bobAgent = await loginAs(bob);

      const responses = await Promise.all([
        aliceAgent.delete(deleteUrl(pending.id)),
        bobAgent.delete(deleteUrl(pending.id)),
      ]);

      expect(responses.map((r) => r.status).sort(), `round ${round + 1}`).toEqual([204, 404]);
      expect(await requestPairs(), `round ${round + 1}`).toEqual([]);
    }
  });
});
