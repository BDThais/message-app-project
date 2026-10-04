import { randomBytes } from 'node:crypto';

/**
 * A secret that cannot be guessed: 32 random bytes (256 bits) from the
 * operating system's CSPRNG, as base64url (43 characters, URL- and
 * cookie-safe). Used for session ids today, and meant for the emailed
 * verification and password-reset tokens later.
 */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}
