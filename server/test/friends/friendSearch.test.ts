import { describe, expect, it } from 'vitest';
import { prisma } from '../../src/lib/prisma';
import { createUser, loginAs } from '../helpers/users';
import { createFriendRequest, makeFriends } from '../helpers/friends';

// The session guard on this route is covered once for every friend route in
// friend.permissions.test.ts; the full list of bad ':tel' values is in
// friend.validator.unit.test.ts.

const searchUrl = (tel: string) => `/friend/search/${tel}`;

describe('GET /friend/search/:tel', () => {
  it('finds a user by exact phone number and returns only what the friend UI needs', async () => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');
    await prisma.user.update({
      where: { id: bob.id },
      data: { avatarUrl: 'https://example.com/bob.png' },
    });
    const agent = await loginAs(alice);

    const res = await agent.get(searchUrl(bob.tel));

    expect(res.status).toBe(200);
    // The whole body is compared, so email, tel and the password hash can't leak.
    expect(res.body).toEqual({
      user: {
        id: bob.id,
        name: 'Bob',
        avatarUrl: 'https://example.com/bob.png',
        relationship: 'none',
      },
    });
  });

  it('answers 200 with user: null when nobody has that number', async () => {
    const alice = await createUser('Alice');
    const agent = await loginAs(alice);

    const res = await agent.get(searchUrl('+84912345678'));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ user: null });
  });

  it('accepts the + sign as-is and percent-encoded', async () => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');
    const agent = await loginAs(alice);

    const raw = await agent.get(searchUrl(bob.tel));
    const encoded = await agent.get(searchUrl(encodeURIComponent(bob.tel)));

    expect(raw.body.user).toMatchObject({ id: bob.id });
    expect(encoded.body).toEqual(raw.body);
  });

  it('rejects a number that is not in E.164 format with 400, without searching', async () => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');
    const agent = await loginAs(alice);

    // Bob's real number, minus the leading '+'.
    const res = await agent.get(searchUrl(bob.tel.slice(1)));

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      message: "'tel' must be a valid phone number in E.164 format, for example +84912345678",
    });
  });

  describe('relationship', () => {
    it('is self when the requester searches their own number', async () => {
      const alice = await createUser('Alice');
      const agent = await loginAs(alice);

      const res = await agent.get(searchUrl(alice.tel));

      expect(res.body.user).toEqual({
        id: alice.id,
        name: 'Alice',
        avatarUrl: null,
        relationship: 'self',
      });
    });

    it('is friend for someone in the requester\'s friend list, from either side', async () => {
      const alice = await createUser('Alice');
      const bob = await createUser('Bob');
      await makeFriends(alice.id, bob.id);

      const fromAlice = await (await loginAs(alice)).get(searchUrl(bob.tel));
      const fromBob = await (await loginAs(bob)).get(searchUrl(alice.tel));

      expect(fromAlice.body.user).toMatchObject({ id: bob.id, relationship: 'friend' });
      expect(fromBob.body.user).toMatchObject({ id: alice.id, relationship: 'friend' });
      // No request to act on, so no requestId key at all.
      expect(fromAlice.body.user).not.toHaveProperty('requestId');
    });

    it('is request_sent for the sender and request_received for the receiver, with the request id', async () => {
      const alice = await createUser('Alice');
      const bob = await createUser('Bob');
      const request = await createFriendRequest(alice.id, bob.id);

      const asSender = await (await loginAs(alice)).get(searchUrl(bob.tel));
      const asReceiver = await (await loginAs(bob)).get(searchUrl(alice.tel));

      expect(asSender.body.user).toEqual({
        id: bob.id,
        name: 'Bob',
        avatarUrl: null,
        relationship: 'request_sent',
        requestId: request.id,
      });
      expect(asReceiver.body.user).toEqual({
        id: alice.id,
        name: 'Alice',
        avatarUrl: null,
        relationship: 'request_received',
        requestId: request.id,
      });
    });

    it('ignores the found user\'s friendships and requests with other users', async () => {
      const alice = await createUser('Alice');
      const bob = await createUser('Bob');
      const carol = await createUser('Carol');
      const dave = await createUser('Dave');
      const erin = await createUser('Erin');
      await makeFriends(bob.id, carol.id);
      await createFriendRequest(dave.id, bob.id);
      await createFriendRequest(bob.id, erin.id);
      const agent = await loginAs(alice);

      const res = await agent.get(searchUrl(bob.tel));

      expect(res.body.user).toEqual({
        id: bob.id,
        name: 'Bob',
        avatarUrl: null,
        relationship: 'none',
      });
    });

    it('is request_received when both users have sent each other a request', async () => {
      // The accepted send-at-the-same-instant race from the planning doc: the
      // received request is the one the requester can accept, and accepting it
      // clears both.
      const alice = await createUser('Alice');
      const bob = await createUser('Bob');
      await createFriendRequest(alice.id, bob.id);
      const theirs = await createFriendRequest(bob.id, alice.id);
      const agent = await loginAs(alice);

      const res = await agent.get(searchUrl(bob.tel));

      expect(res.body.user).toMatchObject({
        relationship: 'request_received',
        requestId: theirs.id,
      });
    });
  });

  it('answers 429 after 30 searches in the window, counted per user', async () => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');
    const aliceAgent = await loginAs(alice);
    const bobAgent = await loginAs(bob);

    for (let i = 0; i < 30; i++) {
      const res = await aliceAgent.get(searchUrl('+84912345678'));
      expect(res.status, `search ${i + 1}`).toBe(200);
    }
    const blocked = await aliceAgent.get(searchUrl('+84912345678'));
    const otherUser = await bobAgent.get(searchUrl('+84912345678'));

    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({ message: 'Too many searches, try again later' });
    expect(otherUser.status).toBe(200);
  });
});
