import { describe, expect, it } from 'vitest';
import { prisma } from '../../src/lib/prisma';
import { createUser, loginAs } from '../helpers/users';
import { createFriendRequest } from '../helpers/friends';

// The session guard on this route is covered once for every friend route in
// friend.permissions.test.ts; the full list of bad `direction` values is in
// friend.validator.unit.test.ts.

const url = '/friend/requests';

describe('GET /friend/requests', () => {
  it('lists the requests sent to the requester by default, newest first, with the sender as user', async () => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');
    const carol = await createUser('Carol');
    const dave = await createUser('Dave');
    const erin = await createUser('Erin');
    const frank = await createUser('Frank');
    await prisma.user.update({
      where: { id: bob.id },
      data: { avatarUrl: 'https://example.com/bob.png' },
    });

    // Created oldest-id first, but the timestamps are not in id order (Bob's
    // request has the lowest id and the newest timestamp), and Dave's and
    // Erin's share a timestamp, so both the sort key and the tie-break show.
    const fromBob = await createFriendRequest(bob.id, alice.id, new Date('2026-09-28T09:00:00.000Z'));
    const fromCarol = await createFriendRequest(carol.id, alice.id, new Date('2026-09-26T09:00:00.000Z'));
    const fromDave = await createFriendRequest(dave.id, alice.id, new Date('2026-09-27T09:00:00.000Z'));
    const fromErin = await createFriendRequest(erin.id, alice.id, new Date('2026-09-27T09:00:00.000Z'));
    // Neither of these concerns Alice's inbox: one she sent, one between two others.
    await createFriendRequest(alice.id, frank.id);
    await createFriendRequest(carol.id, dave.id);
    const agent = await loginAs(alice);

    const res = await agent.get(url);

    expect(res.status).toBe(200);
    // The whole body is compared, so nothing beyond { id, name, avatarUrl } can leak.
    expect(res.body).toEqual({
      requests: [
        {
          id: fromBob.id,
          createdAt: '2026-09-28T09:00:00.000Z',
          user: { id: bob.id, name: 'Bob', avatarUrl: 'https://example.com/bob.png' },
        },
        {
          id: fromErin.id,
          createdAt: '2026-09-27T09:00:00.000Z',
          user: { id: erin.id, name: 'Erin', avatarUrl: null },
        },
        {
          id: fromDave.id,
          createdAt: '2026-09-27T09:00:00.000Z',
          user: { id: dave.id, name: 'Dave', avatarUrl: null },
        },
        {
          id: fromCarol.id,
          createdAt: '2026-09-26T09:00:00.000Z',
          user: { id: carol.id, name: 'Carol', avatarUrl: null },
        },
      ],
    });
    const explicit = await agent.get(url).query({ direction: 'incoming' });
    expect(explicit.status).toBe(200);
    expect(explicit.body).toEqual(res.body);
  });

  it('lists the requests the requester sent when direction is outgoing, with the receiver as user', async () => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');
    const carol = await createUser('Carol');
    const dave = await createUser('Dave');
    const erin = await createUser('Erin');
    // Carol's request is created last (highest id) but is the older one.
    const toBob = await createFriendRequest(alice.id, bob.id, new Date('2026-09-28T09:00:00.000Z'));
    const toCarol = await createFriendRequest(alice.id, carol.id, new Date('2026-09-27T09:00:00.000Z'));
    // Neither of these was sent by Alice: one she received, one between two others.
    await createFriendRequest(dave.id, alice.id);
    await createFriendRequest(erin.id, bob.id);
    const agent = await loginAs(alice);

    const res = await agent.get(url).query({ direction: 'outgoing' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      requests: [
        {
          id: toBob.id,
          createdAt: '2026-09-28T09:00:00.000Z',
          user: { id: bob.id, name: 'Bob', avatarUrl: null },
        },
        {
          id: toCarol.id,
          createdAt: '2026-09-27T09:00:00.000Z',
          user: { id: carol.id, name: 'Carol', avatarUrl: null },
        },
      ],
    });
  });

  it('answers 200 with an empty list when there are no requests in that direction', async () => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');
    await createFriendRequest(alice.id, bob.id);
    const aliceAgent = await loginAs(alice);
    const bobAgent = await loginAs(bob);

    const inbox = await aliceAgent.get(url);
    const sent = await bobAgent.get(url).query({ direction: 'outgoing' });

    expect(inbox.status).toBe(200);
    expect(inbox.body).toEqual({ requests: [] });
    expect(sent.status).toBe(200);
    expect(sent.body).toEqual({ requests: [] });
  });

  it('rejects a direction that is neither incoming nor outgoing with 400', async () => {
    const alice = await createUser('Alice');
    const agent = await loginAs(alice);

    const res = await agent.get(url).query({ direction: 'all' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "'direction' must be 'incoming' or 'outgoing'" });
  });
});
