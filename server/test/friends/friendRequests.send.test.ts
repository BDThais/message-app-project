import { describe, expect, it } from 'vitest';
import { prisma } from '../../src/lib/prisma';
import { createUser, loginAs } from '../helpers/users';
import { createFriendRequest, makeFriends } from '../helpers/friends';

// The session guard on this route is covered once for every friend route in
// friend.permissions.test.ts; the full list of bad `receiver_id` values is in
// friend.validator.unit.test.ts.

const url = '/friend/requests';

describe('POST /friend/requests', () => {
  it('stores the request and answers 201 with the receiver, never their email or tel', async () => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');
    await prisma.user.update({
      where: { id: bob.id },
      data: { avatarUrl: 'https://example.com/bob.png' },
    });
    const agent = await loginAs(alice);

    const res = await agent.post(url).send({ receiver_id: bob.id });

    expect(res.status).toBe(201);
    const stored = await prisma.pendingFriendRequest.findMany();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ senderId: alice.id, receiverId: bob.id });
    // The whole body is compared, so nothing beyond { id, name, avatarUrl } can leak.
    expect(res.body).toEqual({
      request: {
        id: stored[0]!.id,
        createdAt: stored[0]!.createdAt.toISOString(),
        user: { id: bob.id, name: 'Bob', avatarUrl: 'https://example.com/bob.png' },
      },
    });
  });

  it('rejects a receiver_id that is not a valid ID with 400, storing nothing', async () => {
    const alice = await createUser('Alice');
    const agent = await loginAs(alice);

    const res = await agent.post(url).send({ receiver_id: 'bob' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "'receiver_id' must be a valid user ID" });
    expect(await prisma.pendingFriendRequest.count()).toBe(0);
  });

  it("rejects the requester's own ID with 400, storing nothing", async () => {
    const alice = await createUser('Alice');
    const agent = await loginAs(alice);

    const res = await agent.post(url).send({ receiver_id: alice.id });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'You cannot send a friend request to yourself' });
    expect(await prisma.pendingFriendRequest.count()).toBe(0);
  });

  it('rejects an ID that does not refer to an existing user with 400, storing nothing', async () => {
    const alice = await createUser('Alice');
    const agent = await loginAs(alice);

    const res = await agent.post(url).send({ receiver_id: alice.id + 1000 });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'receiver_id does not refer to an existing user' });
    expect(await prisma.pendingFriendRequest.count()).toBe(0);
  });

  it('answers 409 when the two are already friends, storing nothing', async () => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');
    await makeFriends(alice.id, bob.id);
    const agent = await loginAs(alice);

    const res = await agent.post(url).send({ receiver_id: bob.id });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'You are already friends with this user' });
    expect(await prisma.pendingFriendRequest.count()).toBe(0);
  });

  it('answers 409 when the requester already has a pending request to this user', async () => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');
    await createFriendRequest(alice.id, bob.id);
    const agent = await loginAs(alice);

    const res = await agent.post(url).send({ receiver_id: bob.id });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'You have already sent this user a friend request' });
    expect(await prisma.pendingFriendRequest.count()).toBe(1);
  });

  it('answers 409 with the incoming request id when the receiver already sent one', async () => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');
    const incoming = await createFriendRequest(bob.id, alice.id);
    const agent = await loginAs(alice);

    const res = await agent.post(url).send({ receiver_id: bob.id });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      error: 'This user has already sent you a friend request',
      requestId: incoming.id,
    });
    expect(await prisma.pendingFriendRequest.count()).toBe(1);
  });

  it('lets two users send the same request at once: one 201, one 409, one row', async () => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');
    const agent = await loginAs(alice);

    // Whether the second request is stopped by the pre-check or by the unique
    // constraint depends on timing; either way the answer must be the same 409.
    const responses = await Promise.all([
      agent.post(url).send({ receiver_id: bob.id }),
      agent.post(url).send({ receiver_id: bob.id }),
    ]);

    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
    const conflict = responses.find((r) => r.status === 409)!;
    expect(conflict.body).toEqual({ error: 'You have already sent this user a friend request' });
    expect(await prisma.pendingFriendRequest.count()).toBe(1);
  });

  it('answers 429 after 20 requests in the window, counted per user', async () => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');
    const aliceAgent = await loginAs(alice);
    const bobAgent = await loginAs(bob);

    // Requests answered with a 400 count too, so this needs no other users.
    for (let i = 0; i < 20; i++) {
      const res = await aliceAgent.post(url).send({ receiver_id: alice.id });
      expect(res.status, `request ${i + 1}`).toBe(400);
    }
    const blocked = await aliceAgent.post(url).send({ receiver_id: bob.id });
    const otherUser = await bobAgent.post(url).send({ receiver_id: alice.id });

    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({ error: 'Too many friend requests, try again later' });
    expect(otherUser.status).toBe(201);
    expect(await prisma.pendingFriendRequest.count()).toBe(1);
  });
});
