import { describe, expect, it } from 'vitest';
import { prisma } from '../../src/lib/prisma';
import { createUser, loginAs } from '../helpers/users';
import { makeFriends } from '../helpers/friends';
import { createDirectRoom } from '../helpers/chatRooms';

// The session guard on this route is covered once for every friend route in
// friend.permissions.test.ts; the full list of bad `:id` values is in
// friend.validator.unit.test.ts.

const unfriendUrl = (userId: number) => `/friend/${userId}`;

// Every friend-list row as [userId, friendId], in a fixed order.
async function friendPairs() {
  const rows = await prisma.friendListMember.findMany({ orderBy: [{ userId: 'asc' }, { friendId: 'asc' }] });

  return rows.map((row) => [row.userId, row.friendId]);
}

describe('DELETE /friend/:id', () => {
  // Whoever unfriends, both rows go: the rows are removed by the pair, not by
  // "my row", so the direction must not matter.
  it.each([
    ['the user who accepted', 'alice'],
    ['the user who sent the request', 'bob'],
  ] as const)('removes both friend-list rows when %s unfriends, answers 204 with no body and keeps every other friendship', async (_label, caller) => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');
    const carol = await createUser('Carol');
    await makeFriends(alice.id, bob.id);
    await makeFriends(alice.id, carol.id);
    await makeFriends(bob.id, carol.id);
    const [agent, other] = caller === 'alice' ? [await loginAs(alice), bob] : [await loginAs(bob), alice];

    const res = await agent.delete(unfriendUrl(other.id));

    expect(res.status).toBe(204);
    expect(res.text).toBe('');
    expect(await friendPairs()).toEqual([
      [alice.id, carol.id],
      [bob.id, carol.id],
      [carol.id, alice.id],
      [carol.id, bob.id],
    ]);
  });

  it('leaves an existing direct room, its members and its messages untouched', async () => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');
    await makeFriends(alice.id, bob.id);
    const room = await createDirectRoom(alice.id, bob.id);
    await prisma.message.create({ data: { chatId: room.id, senderId: bob.id, content: 'hello' } });
    const agent = await loginAs(alice);

    const res = await agent.delete(unfriendUrl(bob.id));

    expect(res.status).toBe(204);
    expect(await prisma.chatRoom.count({ where: { id: room.id } })).toBe(1);
    expect(await prisma.chatMember.count({ where: { chatId: room.id } })).toBe(2);
    expect(await prisma.message.count({ where: { chatId: room.id } })).toBe(1);
  });

  it('answers 404 when the user is not a friend, does not exist, or is the requester, changing nothing', async () => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');
    const carol = await createUser('Carol');
    await makeFriends(bob.id, carol.id);
    const agent = await loginAs(alice);

    const stranger = await agent.delete(unfriendUrl(bob.id));
    const noSuchUser = await agent.delete(unfriendUrl(carol.id + 1000));
    const self = await agent.delete(unfriendUrl(alice.id));

    for (const res of [stranger, noSuchUser, self]) {
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'You are not friends with this user' });
    }
    expect(await friendPairs()).toEqual([
      [bob.id, carol.id],
      [carol.id, bob.id],
    ]);
  });

  it("goes by the requester's own friend-list row, the one GET /friend reads", async () => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');
    const carol = await createUser('Carol');
    // Half-written friendships (not something the API produces): Alice's row
    // for Bob exists without Bob's, and Carol's row for Alice exists without Alice's.
    await prisma.friendListMember.create({ data: { userId: alice.id, friendId: bob.id } });
    await prisma.friendListMember.create({ data: { userId: carol.id, friendId: alice.id } });
    const agent = await loginAs(alice);

    const carolRes = await agent.delete(unfriendUrl(carol.id));
    expect(carolRes.status).toBe(404);
    expect(await friendPairs()).toEqual([
      [alice.id, bob.id],
      [carol.id, alice.id],
    ]);

    const bobRes = await agent.delete(unfriendUrl(bob.id));
    expect(bobRes.status).toBe(204);
    expect(await friendPairs()).toEqual([[carol.id, alice.id]]);
  });

  it('rejects an :id that is not a valid ID with 400, changing nothing', async () => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');
    await makeFriends(alice.id, bob.id);
    const agent = await loginAs(alice);

    const res = await agent.delete('/friend/abc');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid user id' });
    expect(await friendPairs()).toHaveLength(2);
  });

  it('lets a double click or a second tab unfriend twice at once: never a 5xx, the friendship is gone', async () => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');
    await makeFriends(alice.id, bob.id);
    const agent = await loginAs(alice);

    // Whether the second call finds the friendship already gone (404) or has
    // already passed the check and deletes nothing (204) depends on timing.
    const responses = await Promise.all([agent.delete(unfriendUrl(bob.id)), agent.delete(unfriendUrl(bob.id))]);

    const statuses = responses.map((r) => r.status).sort();
    expect(statuses[0]).toBe(204);
    expect(statuses[1]).toBeOneOf([204, 404]);
    expect(await friendPairs()).toEqual([]);
  });

  it('lets two friends unfriend each other at the same instant: never a 5xx, the friendship is gone', async () => {
    // A few rounds, because whether the two transactions overlap is a matter of timing.
    for (let round = 0; round < 5; round++) {
      const alice = await createUser('Alice');
      const bob = await createUser('Bob');
      await makeFriends(alice.id, bob.id);
      const aliceAgent = await loginAs(alice);
      const bobAgent = await loginAs(bob);

      const responses = await Promise.all([
        aliceAgent.delete(unfriendUrl(bob.id)),
        bobAgent.delete(unfriendUrl(alice.id)),
      ]);

      const statuses = responses.map((r) => r.status);
      expect(statuses, `round ${round + 1}`).toSatisfy((s: number[]) =>
        s.every((status) => status === 204 || status === 404) && s.includes(204)
      );
      expect(await friendPairs(), `round ${round + 1}`).toEqual([]);
    }
  });
});
