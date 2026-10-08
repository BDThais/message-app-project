import { describe, expect, it } from 'vitest';
import { prisma } from '../../src/lib/prisma';

// test/setup.ts puts every test connection in a non-UTC time zone, so a query that compares a
// `timestamp` column with the database's now() (which is wrong by the zone's offset) fails in the
// tests instead of only on a server whose time zone is not UTC. If this fails, that guard is gone.
describe('the test database connection', () => {
  it('runs in a time zone that is not UTC', async () => {
    const [{ zone, offsetHours }] = await prisma.$queryRaw<{ zone: string; offsetHours: number }[]>`
      SELECT current_setting('TimeZone') AS zone,
             (EXTRACT(TIMEZONE FROM now()) / 3600)::int AS "offsetHours"
    `;

    expect(zone).toBe('Asia/Ho_Chi_Minh');
    expect(offsetHours).toBe(7);
  });
});
