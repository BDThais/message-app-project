import { prisma } from '../../lib/prisma';

/**
 * Whether the database answers a trivial query within `timeoutMs`. Never throws: an unreachable database
 * is the answer `false`, which the readiness check reports as a 503.
 */
export async function isDatabaseReachable(timeoutMs = 2_000): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('The database did not answer in time')), timeoutMs);
  });

  try {
    await Promise.race([prisma.$queryRaw`SELECT 1`, timeout]);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
