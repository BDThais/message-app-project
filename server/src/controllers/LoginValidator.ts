import { prisma } from '../lib/prisma';
import { verifyPassword } from '../lib/passwordHash';

/**
 * Checks an email/password pair against the database.
 * Returns the matching user on success, or null if the account doesn't
 * exist or the password is wrong. Deliberately doesn't distinguish
 * between the two, so the controller can send the same generic
 * failure message either way, per the spec.
 */
export async function validateLogin(email: string, password: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return null;

  const passwordMatches = await verifyPassword(user.passwordHash, password);
  if (!passwordMatches) return null;

  return user;
}
