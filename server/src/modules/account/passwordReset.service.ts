import { prisma } from '../../lib/prisma';
import config from '../../config/config';
import { generateToken, hashToken } from '../../lib/randomToken';
import { issueEmailVerification } from './emailVerification.service';

// Database side of the password reset. Nothing here sends mail: the functions
// return what has to be mailed, and the controller sends it after responding
// (see passwordReset.mail.ts).
//
// All the times are JS Dates handed to Prisma and never the database's now()
// or a column default, for the reason given at the top of
// emailVerification.service.ts.
//
// Lock order: wherever a function here touches both rows of an account, it
// takes the user row first and the token row second, which is also the order
// of an account deletion (the user row, then the cascade to its token). Two
// transactions that take them in opposite orders can deadlock.

/** How soon after one reset link the account may be sent another. */
export const RESET_REQUEST_COOLDOWN_MS = 60 * 1000;

/** A fresh token: `token` goes into the mail, only `tokenHash` is stored. */
export function newPasswordResetToken(now: Date = new Date()) {
  const token = generateToken();

  return {
    token,
    tokenHash: hashToken(token),
    createdAt: now,
    expiresAt: new Date(now.getTime() + config.PASSWORD_RESET_TTL_MS),
  };
}

export type IssuePasswordResetResult =
  // A new reset link was stored (replacing the old one): mail `token` to `email`.
  | { status: 'reset_link'; email: string; token: string }
  // The account never verified its address, so it gets the verification link instead (a reset
  // link goes only to a verified address). It was stored the way POST /api/account/email/verification
  // stores it: mail `token` to `email` as a verification link.
  | { status: 'verification_link'; email: string; token: string }
  // No account has this address (compared exactly, like login does).
  | { status: 'unknown_email' }
  // The stored link (reset, or verification for an unverified account) is younger than the cooldown.
  | { status: 'cooldown' };

/**
 * Stores a new reset link for the account with this address, replacing the
 * old one (POST /api/account/password/reset-request). The caller answers the same
 * way whatever this returns, so the answer does not reveal who is registered.
 * `email` is the canonical address (normalizeEmail): the validator has already
 * lower-cased it, and the lookup is an exact match on the stored form.
 *
 * The user row is locked first (SELECT ... FOR UPDATE), as in
 * issueEmailVerification: without it two simultaneous requests could both
 * find the stored link older than the cooldown, and both send a mail. With it
 * the second waits, then sees the link the first one stored. The lock also
 * means the account cannot become verified between the check below and the
 * verification link being stored, because that is done in this transaction.
 */
export function issuePasswordReset(email: string, now: Date = new Date()): Promise<IssuePasswordResetResult> {
  return prisma.$transaction(async (tx): Promise<IssuePasswordResetResult> => {
    const [locked] = await tx.$queryRaw<{ id: number }[]>`SELECT id FROM users WHERE email = ${email} FOR UPDATE`;
    if (!locked) return { status: 'unknown_email' };
    const userId = locked.id;

    const user = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: { email: true, emailVerifiedAt: true, passwordResetToken: { select: { createdAt: true } } },
    });

    if (user.emailVerifiedAt === null) {
      const verification = await issueEmailVerification(userId, now, tx);
      if (verification.status === 'issued') {
        return { status: 'verification_link', email: verification.email, token: verification.token };
      }
      // 'cooldown'. 'already_verified' and 'no_user' cannot happen: this transaction holds the
      // row lock and has just seen the account unverified. Were it ever to, sending nothing is the
      // answer that reveals nothing.
      return { status: 'cooldown' };
    }

    const stored = user.passwordResetToken;
    if (stored && now.getTime() - stored.createdAt.getTime() < RESET_REQUEST_COOLDOWN_MS) {
      return { status: 'cooldown' };
    }

    const { token, tokenHash, createdAt, expiresAt } = newPasswordResetToken(now);
    // `createdAt` is set on both branches: its default only applies to a new row, and the
    // cooldown counts from the newest link.
    await tx.passwordResetToken.upsert({
      where: { userId },
      create: { userId, tokenHash, expiresAt, createdAt },
      update: { tokenHash, expiresAt, createdAt },
    });

    return { status: 'reset_link', email: user.email, token };
  });
}

export type ResetPasswordResult =
  // The password was replaced and every session of the account deleted. Mail the "your password
  // was changed" notice to `email`.
  | { status: 'reset'; email: string }
  // Unknown, used, replaced or expired token. One result for all of them, so the answer says
  // nothing about which it was.
  | { status: 'invalid' };

/**
 * Uses a token from a reset mail (POST /api/account/password/reset): the account
 * gets `newPasswordHash` and is signed out everywhere, expired sessions
 * included, so nobody who held a session before the reset keeps it. The
 * caller hashes the password first, so an unknown token costs the same time
 * as a good one.
 *
 * In one transaction the token row is deleted (only while `expiresAt` is still
 * in the future; a count of 1 means this request claimed it), then the hash is
 * stored and the sessions are deleted. Of two simultaneous requests with the
 * same token only one can claim the row (the other waits for the user row,
 * then finds the token gone), so a link works once, and a failure rolls
 * everything back, so the link survives it. An expired row is left where it
 * is: there is at most one per user, and it is replaced the next time they
 * ask for a link.
 */
export function resetPasswordWithToken(
  token: string,
  newPasswordHash: string,
  now: Date = new Date()
): Promise<ResetPasswordResult> {
  const tokenHash = hashToken(token);

  return prisma.$transaction(async (tx): Promise<ResetPasswordResult> => {
    // tokenHash is unique, so this finds the one row the link was issued for.
    const row = await tx.passwordResetToken.findUnique({ where: { tokenHash } });
    if (!row) return { status: 'invalid' };

    // The user row before the token row (see the lock order at the top of the file).
    const [locked] = await tx.$queryRaw<{ email: string }[]>`SELECT email FROM users WHERE id = ${row.userId} FOR UPDATE`;
    if (!locked) return { status: 'invalid' };

    const claimed = await tx.passwordResetToken.deleteMany({ where: { tokenHash, expiresAt: { gt: now } } });
    if (claimed.count === 0) return { status: 'invalid' };

    await tx.user.update({ where: { id: row.userId }, data: { passwordHash: newPasswordHash } });
    await tx.session.deleteMany({ where: { userId: row.userId } });

    return { status: 'reset', email: locked.email };
  });
}
