import { describe, expect, it } from 'vitest';
import { prisma } from '../../src/lib/prisma';
import { createUser } from '../helpers/users';

// Guards the rules the hand-written migration encodes (the schema engine is not available
// everywhere): one token per user, a token hash maps to one user, and the token goes with its user.

function tokenData(userId: number, tokenHash: string) {
  return { userId, tokenHash, expiresAt: new Date(Date.now() + 60_000) };
}

describe('PasswordResetToken (schema)', () => {
  it('holds at most one token per user, and a token hash only once', async () => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');
    await prisma.passwordResetToken.create({ data: tokenData(alice.id, 'hash-1') });

    await expect(prisma.passwordResetToken.create({ data: tokenData(alice.id, 'hash-2') })).rejects.toMatchObject({ code: 'P2002' });
    await expect(prisma.passwordResetToken.create({ data: tokenData(bob.id, 'hash-1') })).rejects.toMatchObject({ code: 'P2002' });
  });

  it('is deleted with its user', async () => {
    const alice = await createUser('Alice');
    await prisma.passwordResetToken.create({ data: tokenData(alice.id, 'hash-1') });

    await prisma.user.delete({ where: { id: alice.id } });

    expect(await prisma.passwordResetToken.count()).toBe(0);
  });
});
