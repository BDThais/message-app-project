import { describe, expect, it } from 'vitest';
import { prisma } from '../../src/lib/prisma';
import { createUser, loginAs } from '../helpers/users';
import { createFriendRequest, makeFriends } from '../helpers/friends';

// The session guard on this route is covered once for every friend route in
// friend.permissions.test.ts; the full list of bad `:id` values is in
// friend.validator.unit.test.ts.

const acceptUrl = (requestId: number) => `/friend/requests/${requestId}/accept`;

// Every friend-list row as [userId, friendId], in a fixed order.
async function friendPairs() {
  const rows = await prisma.friendListMember.findMany({ orderBy: [{ userId: 'asc' }, { friendId: 'asc' }] });

  return rows.map((row) => [row.userId, row.friendId]);
}

describe('POST /friend/requests/:id/accept', () => {
  it('makes the two users friends, deletes the request and answers 201 with the sender, never their email or tel', async () => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');
    await prisma.user.update({
      where: { id: bob.id },
      data: { avatarUrl: 'https://example.com/bob.png' },
    });
    const pending = await createFriendRequest(bob.id, alice.id);
    const agent = await loginAs(alice);

    const res = await agent.post(acceptUrl(pending.id));

    expect(res.status).toBe(201);
    // The whole body is compared, so nothing beyond { id, name, avatarUrl } can leak.
    expect(res.body).toEqual({
      friend: { id: bob.id, name: 'Bob', avatarUrl: 'https://example.com/bob.png' },
    });
    // One friend-list row per direction, and the request is gone.
    expect(await friendPairs()).toEqual([
      [alice.id, bob.id],
      [bob.id, alice.id],
    ]);
    expect(await prisma.pendingFriendRequest.count()).toBe(0);
    // Starting a conversation is the client's next call (POST /chat), not part of accepting.
    expect(await prisma.chatRoom.count()).toBe(0);
  });

  it("deletes the pair's requests in both directions and leaves every other request alone", async () => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');
    const carol = await createUser('Carol');
    const dave = await createUser('Dave');
    // Bob and Alice sent each other a request at the same instant (the accepted race).
    const fromBob = await createFriendRequest(bob.id, alice.id);
    const toBob = await createFriendRequest(alice.id, bob.id);
    const fromCarol = await createFriendRequest(carol.id, alice.id);
    const toDave = await createFriendRequest(alice.id, dave.id);
    const carolToBob = await createFriendRequest(carol.id, bob.id);
    const agent = await loginAs(alice);

    const res = await agent.post(acceptUrl(fromBob.id));

    expect(res.status).toBe(201);
    const left = await prisma.pendingFriendRequest.findMany({ orderBy: { id: 'asc' } });
    expect(left.map((r) => r.id)).toEqual([fromCarol.id, toDave.id, carolToBob.id]);
    expect(left.map((r) => r.id)).not.toContain(toBob.id);
    expect(await friendPairs()).toEqual([
      [alice.id, bob.id],
      [bob.id, alice.id],
    ]);
  });

  it("answers 404 when the request does not exist or is not addressed to the requester, changing nothing", async () => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');
    const carol = await createUser('Carol');
    const pending = await createFriendRequest(alice.id, bob.id);
    const aliceAgent = await loginAs(alice);
    const carolAgent = await loginAs(carol);

    const noSuchRequest = await aliceAgent.post(acceptUrl(pending.id + 1000));
    // Alice sent this one, so only Bob can accept it; Carol has nothing to do with it.
    const bySender = await aliceAgent.post(acceptUrl(pending.id));
    const byStranger = await carolAgent.post(acceptUrl(pending.id));

    for (const res of [noSuchRequest, bySender, byStranger]) {
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'Friend request not found' });
    }
    expect(await prisma.pendingFriendRequest.count()).toBe(1);
    expect(await prisma.friendListMember.count()).toBe(0);
  });

  it('answers 404 when the request was already accepted', async () => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');
    const pending = await createFriendRequest(bob.id, alice.id);
    const agent = await loginAs(alice);
    await agent.post(acceptUrl(pending.id));

    const again = await agent.post(acceptUrl(pending.id));

    expect(again.status).toBe(404);
    expect(again.body).toEqual({ error: 'Friend request not found' });
    expect(await friendPairs()).toHaveLength(2);
  });

  it('completes a friendship that only has one of its two rows instead of failing', async () => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');
    const pending = await createFriendRequest(bob.id, alice.id);
    await prisma.friendListMember.create({ data: { userId: bob.id, friendId: alice.id } });
    const agent = await loginAs(alice);

    const res = await agent.post(acceptUrl(pending.id));

    expect(res.status).toBe(201);
    expect(await friendPairs()).toEqual([
      [alice.id, bob.id],
      [bob.id, alice.id],
    ]);
    expect(await prisma.pendingFriendRequest.count()).toBe(0);
  });

  it('accepts a leftover request between two users who are already friends, as a repeat', async () => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');
    await makeFriends(alice.id, bob.id);
    const pending = await createFriendRequest(bob.id, alice.id);
    const agent = await loginAs(alice);

    const res = await agent.post(acceptUrl(pending.id));

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ friend: { id: bob.id, name: 'Bob', avatarUrl: null } });
    expect(await friendPairs()).toHaveLength(2);
    expect(await prisma.pendingFriendRequest.count()).toBe(0);
  });

  it('rejects an :id that is not a valid ID with 400, changing nothing', async () => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');
    await createFriendRequest(bob.id, alice.id);
    const agent = await loginAs(alice);

    const res = await agent.post('/friend/requests/abc/accept');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid friend request id' });
    expect(await prisma.pendingFriendRequest.count()).toBe(1);
    expect(await prisma.friendListMember.count()).toBe(0);
  });

  it('lets a double click or a second tab accept the same request at once: never a 5xx, one friendship', async () => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');
    const pending = await createFriendRequest(bob.id, alice.id);
    const agent = await loginAs(alice);

    // Whether the second call finds the request already gone (404) or waits
    // for the first one and skips the existing rows (201) depends on timing.
    const responses = await Promise.all([
      agent.post(acceptUrl(pending.id)),
      agent.post(acceptUrl(pending.id)),
    ]);

    const statuses = responses.map((r) => r.status).sort();
    expect(statuses[0]).toBe(201);
    expect(statuses[1]).toBeOneOf([201, 404]);
    expect(await friendPairs()).toEqual([
      [alice.id, bob.id],
      [bob.id, alice.id],
    ]);
    expect(await prisma.pendingFriendRequest.count()).toBe(0);
  });

  it('lets two users who sent each other a request accept at the same instant: never a 5xx, one friendship', async () => {
    // A few rounds, because whether the two transactions overlap is a matter of timing.
    for (let round = 0; round < 5; round++) {
      await prisma.friendListMember.deleteMany();
      const alice = await createUser('Alice');
      const bob = await createUser('Bob');
      const fromAlice = await createFriendRequest(alice.id, bob.id);
      const fromBob = await createFriendRequest(bob.id, alice.id);
      const aliceAgent = await loginAs(alice);
      const bobAgent = await loginAs(bob);

      const responses = await Promise.all([
        bobAgent.post(acceptUrl(fromAlice.id)),
        aliceAgent.post(acceptUrl(fromBob.id)),
      ]);

      const statuses = responses.map((r) => r.status);
      expect(statuses, `round ${round + 1}`).toSatisfy((s: number[]) =>
        s.every((status) => status === 201 || status === 404) && s.includes(201)
      );
      expect(await friendPairs(), `round ${round + 1}`).toEqual([
        [alice.id, bob.id],
        [bob.id, alice.id],
      ]);
      expect(await prisma.pendingFriendRequest.count(), `round ${round + 1}`).toBe(0);
    }
  });
});
