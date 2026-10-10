import { hashPassword } from '../../src/lib/passwordHash';
import { prisma } from '../../src/lib/prisma';
import { generateToken, hashToken } from '../../src/lib/randomToken';
import { createUser } from './users';

/**
 * A user whose email address is verified (a reset link goes only to such an
 * account). With `password` the account really has that password, so a test
 * can log in with it; without, the hash is the helper's placeholder.
 */
export async function createVerifiedUser(name: string, password?: string) {
  const user = await createUser(name);

  return prisma.user.update({
    where: { id: user.id },
    data: {
      emailVerifiedAt: new Date(),
      ...(password !== undefined && { passwordHash: await hashPassword(password) }),
    },
  });
}

/**
 * Stores a reset link for `user` (a user has at most one) and returns its
 * token, as the mail would carry it. By default it was made just now and is
 * valid for an hour; each of those can be set to put the link in a particular
 * state. To read the token of a mailed link use `tokenFromMail`
 * (helpers/emailVerification.ts).
 */
export async function createResetLink(
  user: { id: number },
  options: { createdAt?: Date; expiresAt?: Date } = {}
): Promise<string> {
  const token = generateToken();

  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(token),
      createdAt: options.createdAt ?? new Date(),
      expiresAt: options.expiresAt ?? new Date(Date.now() + 60 * 60 * 1000),
    },
  });

  return token;
}
