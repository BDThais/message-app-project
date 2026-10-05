import { describe, expect, it } from 'vitest';
import { prisma } from '../../src/lib/prisma';
import { createUser, loginAs } from '../helpers/users';
import { createFriendRequest, makeFriends } from '../helpers/friends';

// The session guard on this route is covered once for every friend route in
// friend.permissions.test.ts.

const url = '/friend';

describe('GET /friend', () => {
  it("lists the requester's friends sorted by name without regard to case, never their email or tel", async () => {
    const alice = await createUser('Alice');
    // Created in an order that is neither the name order nor the order a
    // case-sensitive sort gives (every capital letter before every lower-case
    // one). 'bob' and 'Bob' differ only in case, so the user ID has to break
    // the tie, and 'bob' has the lower one.
    const dave = await createUser('dave');
    const lowerBob = await createUser('bob');
    const carol = await createUser('Carol');
    const upperBob = await createUser('Bob');
    const erin = await createUser('Erin');
    const frank = await createUser('Frank');
    await prisma.user.update({
      where: { id: carol.id },
      data: { avatarUrl: 'https://example.com/carol.png' },
    });
    // The rows go in with 'Bob' before 'bob', the opposite of their ID order, so
    // the database does not hand them back already in the order the test expects.
    await makeFriends(alice.id, upperBob.id);
    await makeFriends(alice.id, dave.id);
    await makeFriends(alice.id, carol.id);
    await makeFriends(alice.id, lowerBob.id);
    // Neither of these is Alice's friend: a pending request is not a friendship,
    // and Frank is only Dave's friend.
    await createFriendRequest(erin.id, alice.id);
    await makeFriends(dave.id, frank.id);
    const agent = await loginAs(alice);

    const res = await agent.get(url);

    expect(res.status).toBe(200);
    // The whole body is compared, so nothing beyond { id, name, avatarUrl } can leak.
    expect(res.body).toEqual({
      friends: [
        { id: lowerBob.id, name: 'bob', avatarUrl: null },
        { id: upperBob.id, name: 'Bob', avatarUrl: null },
        { id: carol.id, name: 'Carol', avatarUrl: 'https://example.com/carol.png' },
        { id: dave.id, name: 'dave', avatarUrl: null },
      ],
    });
  });

  it("goes by the requester's own friend-list row, the one DELETE /friend/:id and the search read", async () => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');
    const carol = await createUser('Carol');
    // Half-written friendships (not something the API produces): Alice's row
    // for Bob exists without Bob's, and Carol's row for Alice exists without Alice's.
    await prisma.friendListMember.create({ data: { userId: alice.id, friendId: bob.id } });
    await prisma.friendListMember.create({ data: { userId: carol.id, friendId: alice.id } });
    const aliceAgent = await loginAs(alice);
    const bobAgent = await loginAs(bob);

    const aliceRes = await aliceAgent.get(url);
    const bobRes = await bobAgent.get(url);

    expect(aliceRes.body).toEqual({ friends: [{ id: bob.id, name: 'Bob', avatarUrl: null }] });
    expect(bobRes.body).toEqual({ friends: [] });
  });

  it('answers 200 with an empty list when the requester has no friends', async () => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');
    const carol = await createUser('Carol');
    // Other people's friendships and a pending request are not Alice's friends.
    await makeFriends(bob.id, carol.id);
    await createFriendRequest(alice.id, bob.id);
    const agent = await loginAs(alice);

    const res = await agent.get(url);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ friends: [] });
  });
});
