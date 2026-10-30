import pg from 'pg';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import app from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { directRoomLockKey } from '../../src/modules/chatrooms/chatRoom.service';
import { makeFriends } from '../helpers/friends';
import { createUser, loginAs } from '../helpers/users';

// Nothing in the schema says that two users have one direct room, so POST /api/chat looks for the
// pair's room and creates one when there is none. Two requests for the same pair at the same moment
// must not both create it: the creation takes an advisory lock on the pair.

/** Waits until some backend is waiting for a lock, i.e. until the request under test has reached the other connection's lock. */
async function waitForBlockedBackend(timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const [row] = await prisma.$queryRaw<{ waiting: bigint }[]>`
      SELECT count(*) AS waiting FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'
    `;
    if (Number(row?.waiting) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('the request never waited for the lock');
}

describe('directRoomLockKey', () => {
  it('is the same key whichever user comes first, and a different key for each pair', () => {
    expect(directRoomLockKey(3, 9)).toBe(directRoomLockKey(9, 3));
    expect(directRoomLockKey(3, 9)).not.toBe(directRoomLockKey(3, 10));
    expect(directRoomLockKey(3, 9)).not.toBe(directRoomLockKey(4, 9));
    expect(directRoomLockKey(1, 2)).not.toBe(directRoomLockKey(2, 3));
  });

  it('fits the largest ids a Postgres integer holds, without overflowing a bigint', () => {
    const MAX_INT32 = 2_147_483_647;

    expect(directRoomLockKey(MAX_INT32 - 1, MAX_INT32)).toBeGreaterThan(0n);
    expect(directRoomLockKey(MAX_INT32 - 1, MAX_INT32)).toBeLessThan(2n ** 63n);
    expect(directRoomLockKey(MAX_INT32 - 1, MAX_INT32)).not.toBe(directRoomLockKey(MAX_INT32, MAX_INT32 - 2));
  });
});

describe('POST /api/chat for a direct room (simultaneous requests)', () => {
  it('waits for a creation that is in progress for the same pair, then answers with that room instead of making a second', async () => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');
    await makeFriends(alice.id, bob.id);
    const agent = await loginAs(alice);
    const other = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await other.connect();

    try {
      // The other request, half way through: it holds the pair's lock and has not committed yet.
      await other.query('BEGIN');
      await other.query('SELECT pg_advisory_xact_lock($1)', [directRoomLockKey(bob.id, alice.id).toString()]);

      const response = agent.post('/api/chat').send({ type: 'direct', member_ids: [bob.id] });
      // Settled when the test body fails before it awaits `response`, so a late rejection is not reported twice.
      response.then(undefined, () => {});
      await waitForBlockedBackend();

      const {
        rows: [{ id: roomId }],
      } = await other.query<{ id: number }>("INSERT INTO chat_rooms (type) VALUES ('direct') RETURNING id");
      await other.query("INSERT INTO chat_members (chat_id, member_id, role) VALUES ($1, $2, 'admin'), ($1, $3, 'admin')", [
        roomId,
        alice.id,
        bob.id,
      ]);
      await other.query('COMMIT');

      const res = await response;
      expect(res.status).toBe(200); // an existing room reused, not 201
      expect(res.body.chatRoom.id).toBe(roomId);
      expect(await prisma.chatRoom.count()).toBe(1);
    } finally {
      await other.end();
    }
  });

  it('makes one room for the pair when many requests arrive together, from either side', async () => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');
    await makeFriends(alice.id, bob.id);
    const asAlice = await loginAs(alice);
    const asBob = await loginAs(bob);

    const responses = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        index % 2 === 0
          ? asAlice.post('/api/chat').send({ type: 'direct', member_ids: [bob.id] })
          : asBob.post('/api/chat').send({ type: 'direct', member_ids: [alice.id] }),
      ),
    );

    expect(responses.map(({ status }) => status).sort()).toEqual([200, 200, 200, 200, 200, 200, 200, 201]);
    expect(new Set(responses.map(({ body }) => body.chatRoom.id)).size).toBe(1);
    expect(await prisma.chatRoom.count()).toBe(1);
  });

  it('does not make two users wait for each other when their pairs differ', async () => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');
    const carl = await createUser('Carl');
    await makeFriends(alice.id, bob.id);
    await makeFriends(alice.id, carl.id);
    const agent = await loginAs(alice);
    const other = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await other.connect();

    try {
      await other.query('BEGIN');
      await other.query('SELECT pg_advisory_xact_lock($1)', [directRoomLockKey(alice.id, bob.id).toString()]);

      const withCarl = await agent.post('/api/chat').send({ type: 'direct', member_ids: [carl.id] });

      expect(withCarl.status).toBe(201);
      await other.query('ROLLBACK');
    } finally {
      await other.end();
    }
  });
});
