import { normalizeEmail } from '../../lib/emailAddress';
import { verifyPassword } from '../../lib/passwordHash';
import { findUserByEmail } from './account.service';

/**
 * Checks an email/password pair against the database.
 * Returns the matching user on success, or null if the account doesn't
 * exist or the password is wrong. Deliberately doesn't distinguish
 * between the two, so the controller can send the same generic
 * failure message either way, per the spec.
 *
 * The address is looked up lower-cased, as it is stored (normalizeEmail): the
 * case it was typed in does not matter. It is not checked for being a valid
 * address: anything else simply matches no account.
 */
export async function validateLogin(email: string, password: string) {
  const user = await findUserByEmail(normalizeEmail(email));
  if (!user) return null;

  const passwordMatches = await verifyPassword(user.passwordHash, password);
  if (!passwordMatches) return null;

  return user;
}
