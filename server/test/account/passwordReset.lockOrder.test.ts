import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { prisma } from '../../src/lib/prisma';
import { resetPasswordWithToken } from '../../src/modules/account/passwordReset.service';
import { createResetLink, createVerifiedUser } from '../helpers/passwordReset';
import { countUsers } from '../helpers/users';

// resetPasswordWithToken takes the user row before the token row, which is also the order of an
// account deletion (the user row, then the cascade to its token). In the other order a reset and a
// deletion of the same account that overlap wait for each other, and Postgres aborts one of them.
// The overlap is built by hand: a second connection holds the user row, the reset runs into it, and
// only then does the deletion go ahead.

/** Waits until some backend is waiting for a lock, i.e. until the request under test has reached the other connection's row. */
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

describe('resetPasswordWithToken (lock order)', () => {
  it('does not deadlock with a deletion of the same account that overlaps it, and answers as for a dead link', async () => {
    const alice = await createVerifiedUser('Alice');
    const token = await createResetLink(alice);
    const deleter = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await deleter.connect();

    try {
      await deleter.query('BEGIN');
      await deleter.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [alice.id]);

      const reset = resetPasswordWithToken(token, 'new-hash');
      // Settled when the test body fails before it awaits `reset`, so a late rejection is not reported twice.
      reset.catch(() => {});
      await waitForBlockedBackend();

      // The deletion cascades to the token row. It must find that row unlocked: the reset is still
      // waiting for the user row and has not touched the token.
      await deleter.query('DELETE FROM users WHERE id = $1', [alice.id]);
      await deleter.query('COMMIT');

      expect(await reset).toEqual({ status: 'invalid' });
      expect(await countUsers()).toBe(0);
    } finally {
      await deleter.end();
    }
  });
});
