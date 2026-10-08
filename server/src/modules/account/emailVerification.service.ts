import { prisma } from '../../lib/prisma';
import config from '../../config/config';
import { generateToken, hashToken } from '../../lib/randomToken';

// Database side of email verification. Nothing here sends mail: the functions
// return the token that has to be mailed, and the controller sends it after
// responding (see emailVerification.mail.ts).
//
// All the times are JS Dates handed to Prisma, like everywhere else in the
// project, and never the database's now() or a column default (`created_at`
// is set explicitly): the columns are `timestamp` without a time zone, so
// comparing one with now() is off by the session's UTC offset on any
// connection whose TimeZone is not UTC. The tests run in a zone that is not
// UTC for that reason (see test/setup.ts).

/** How soon after one verification mail the account may ask for another. */
export const RESEND_COOLDOWN_MS = 60 * 1000;

/** A fresh token: `token` goes into the mail, only `tokenHash` is stored. */
export function newVerificationToken(now: Date = new Date()) {
  const token = generateToken();

  return {
    token,
    tokenHash: hashToken(token),
    createdAt: now,
    expiresAt: new Date(now.getTime() + config.EMAIL_VERIFICATION_TTL_MS),
  };
}

export type IssueVerificationResult =
  // A new link was stored (replacing the old one): mail `token` to `email`.
  | { status: 'issued'; email: string; token: string }
  | { status: 'already_verified' }
  // The stored link is younger than RESEND_COOLDOWN_MS.
  | { status: 'cooldown' }
  // The account is gone (deleted between the session lookup and now).
  | { status: 'no_user' };

/**
 * Stores a new verification link for the account's current address, replacing
 * the old one (POST /account/email/verification).
 *
 * The user row is locked first (SELECT ... FOR UPDATE): without it two
 * simultaneous requests could both find the stored link older than the
 * cooldown, and both send a mail. With it the second waits, then sees the
 * link the first one stored and is told to wait.
 */
export function issueEmailVerification(userId: number, now: Date = new Date()): Promise<IssueVerificationResult> {
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: number }[]>`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
    if (locked.length === 0) return { status: 'no_user' };

    const user = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: { email: true, emailVerifiedAt: true, emailVerificationToken: { select: { createdAt: true } } },
    });
    if (user.emailVerifiedAt !== null) return { status: 'already_verified' };

    const stored = user.emailVerificationToken;
    if (stored && now.getTime() - stored.createdAt.getTime() < RESEND_COOLDOWN_MS) {
      return { status: 'cooldown' };
    }

    const { token, tokenHash, createdAt, expiresAt } = newVerificationToken(now);
    // `createdAt` is set on both branches: its default only applies to a new row, and the
    // cooldown counts from the newest link.
    await tx.emailVerificationToken.upsert({
      where: { userId },
      create: { userId, email: user.email, tokenHash, expiresAt, createdAt },
      update: { email: user.email, tokenHash, expiresAt, createdAt },
    });

    return { status: 'issued', email: user.email, token };
  });
}

export type VerifyEmailResult =
  | { status: 'verified' }
  // Unknown, used, expired or replaced token, or one issued for an address the account no longer has.
  // One result for all of them, so the answer says nothing about which it was.
  | { status: 'invalid' };

/**
 * Uses a token from a verification mail (POST /account/email/verify): the
 * account's address counts as verified from `now` on.
 *
 * In one transaction the token row is deleted, and the user is updated only if
 * it still has the address the link was issued for. Of two simultaneous
 * requests with the same token only one can delete the row (the other waits
 * for the first transaction, then finds the row gone), so a link works once.
 * An expired row is left where it is: there is at most one per user, and it is
 * replaced the next time they ask for a link.
 *
 * An account that is already verified keeps its original timestamp. That can
 * only happen when a link is issued at the very moment an earlier one is
 * used, but the answer is still a success: the address is verified.
 */
export function verifyEmailToken(token: string, now: Date = new Date()): Promise<VerifyEmailResult> {
  const tokenHash = hashToken(token);

  return prisma.$transaction(async (tx) => {
    // tokenHash is unique, so this finds the one row the link was issued for.
    const row = await tx.emailVerificationToken.findUnique({ where: { tokenHash } });
    if (!row) return { status: 'invalid' };

    const claimed = await tx.emailVerificationToken.deleteMany({ where: { tokenHash, expiresAt: { gt: now } } });
    if (claimed.count === 0) return { status: 'invalid' };

    const verified = await tx.user.updateMany({
      where: { id: row.userId, email: row.email, emailVerifiedAt: null },
      data: { emailVerifiedAt: now },
    });
    if (verified.count === 1) return { status: 'verified' };

    // Nothing was updated: the account either was verified already (fine), or no longer has
    // this address (the link is dead; it is consumed above, since nothing could use it).
    const stillTheirs = await tx.user.count({ where: { id: row.userId, email: row.email } });
    return stillTheirs === 1 ? { status: 'verified' } : { status: 'invalid' };
  });
}
