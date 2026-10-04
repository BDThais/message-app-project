import { describe, expect, it } from 'vitest';
import { prisma } from '../../src/lib/prisma';
import { createUser } from '../helpers/users';

// The table has no endpoint yet; these guard the rules the migration encodes (it is written by
// hand, because the schema engine is not available everywhere): one token per user, a token hash
// maps to one user, and the token goes with its user.

function tokenData(userId: number, tokenHash: string) {
  return { userId, email: 'alice@example.com', tokenHash, expiresAt: new Date(Date.now() + 60_000) };
}

describe('EmailVerificationToken (schema)', () => {
  it('holds at most one token per user, and a token hash only once', async () => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');
    await prisma.emailVerificationToken.create({ data: tokenData(alice.id, 'hash-1') });

    await expect(prisma.emailVerificationToken.create({ data: tokenData(alice.id, 'hash-2') })).rejects.toMatchObject({ code: 'P2002' });
    await expect(prisma.emailVerificationToken.create({ data: tokenData(bob.id, 'hash-1') })).rejects.toMatchObject({ code: 'P2002' });
  });

  it('is deleted with its user, and a new user starts unverified', async () => {
    const alice = await createUser('Alice');
    await prisma.emailVerificationToken.create({ data: tokenData(alice.id, 'hash-1') });
    expect(alice.emailVerifiedAt).toBeNull();

    await prisma.user.delete({ where: { id: alice.id } });

    expect(await prisma.emailVerificationToken.count()).toBe(0);
  });
});
