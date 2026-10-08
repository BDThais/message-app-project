import { createHash, randomBytes } from 'node:crypto';

/**
 * A secret that cannot be guessed: 32 random bytes (256 bits) from the
 * operating system's CSPRNG, as base64url (43 characters, URL- and
 * cookie-safe). Used for session ids and for the emailed verification token,
 * and meant for the password-reset token too.
 */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * The SHA-256 of a token, as 64 hex characters. An emailed token is stored
 * only in this form, so a leaked table gives nobody a working link. A plain
 * fast hash is enough here (no salt, no password hashing): the input is 256
 * random bits, so there is nothing to guess or to look up in a table of
 * precomputed hashes.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
