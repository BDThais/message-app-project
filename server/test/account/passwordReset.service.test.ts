import { describe, expect, it } from 'vitest';
import config from '../../src/config/config';
import { prisma } from '../../src/lib/prisma';
import { hashToken } from '../../src/lib/randomToken';
import { verifyEmailToken } from '../../src/modules/account/emailVerification.service';
import {
  RESET_REQUEST_COOLDOWN_MS,
  issuePasswordReset,
  newPasswordResetToken,
  resetPasswordWithToken,
} from '../../src/modules/account/passwordReset.service';
import { createVerificationLink } from '../helpers/emailVerification';
import { createResetLink, createVerifiedUser } from '../helpers/passwordReset';
import { createSessionRow, createUser } from '../helpers/users';

// How many accounts a race between two simultaneous requests is tried on.
const RACE_ROUNDS = 8;

describe('newPasswordResetToken', () => {
  it('returns a token and its hash, valid for the configured time from `now`', () => {
    const now = new Date('2026-10-08T10:00:00.000Z');

    const { token, tokenHash, createdAt, expiresAt } = newPasswordResetToken(now);

    expect(tokenHash).toBe(hashToken(token));
    expect(createdAt).toEqual(now);
    expect(expiresAt.getTime()).toBe(now.getTime() + config.PASSWORD_RESET_TTL_MS);
    expect(newPasswordResetToken(now).token).not.toBe(token);
  });
});

describe('issuePasswordReset', () => {
  it('stores a link for a verified account and returns the token to mail', async () => {
    const alice = await createVerifiedUser('Alice');
    const now = new Date();

    const result = await issuePasswordReset(alice.email, now);

    expect(result).toMatchObject({ status: 'reset_link', email: alice.email });
    if (result.status !== 'reset_link') throw new Error('unreachable');
    const stored = await prisma.passwordResetToken.findUniqueOrThrow({ where: { userId: alice.id } });
    expect(stored.tokenHash).toBe(hashToken(result.token));
    expect(stored.createdAt).toEqual(now);
    expect(stored.expiresAt.getTime()).toBe(now.getTime() + config.PASSWORD_RESET_TTL_MS);
    expect(await resetPasswordWithToken(result.token, 'new-hash')).toEqual({ status: 'reset', email: alice.email });
  });

  it('replaces the old link (a new row is never added), which stops working', async () => {
    const alice = await createVerifiedUser('Alice');
    const oldToken = await createResetLink(alice, { createdAt: new Date(Date.now() - 2 * RESET_REQUEST_COOLDOWN_MS) });
    const now = new Date();

    const result = await issuePasswordReset(alice.email, now);

    expect(result.status).toBe('reset_link');
    if (result.status !== 'reset_link') throw new Error('unreachable');
    expect(await prisma.passwordResetToken.count()).toBe(1);
    expect((await prisma.passwordResetToken.findUniqueOrThrow({ where: { userId: alice.id } })).createdAt).toEqual(now);
    expect(await resetPasswordWithToken(oldToken, 'new-hash')).toEqual({ status: 'invalid' });
    expect((await resetPasswordWithToken(result.token, 'new-hash')).status).toBe('reset');
  });

  it('makes the cooldown last 60 seconds from the stored link, to the millisecond', async () => {
    const alice = await createVerifiedUser('Alice');
    const createdAt = new Date('2026-10-08T10:00:00.000Z');
    await createResetLink(alice, { createdAt });

    const justBefore = await issuePasswordReset(alice.email, new Date(createdAt.getTime() + RESET_REQUEST_COOLDOWN_MS - 1));
    const exactly = await issuePasswordReset(alice.email, new Date(createdAt.getTime() + RESET_REQUEST_COOLDOWN_MS));

    expect(justBefore).toEqual({ status: 'cooldown' });
    expect(exactly.status).toBe('reset_link');
  });

  it('leaves the stored link alone while the cooldown lasts', async () => {
    const alice = await createVerifiedUser('Alice');
    const token = await createResetLink(alice);
    const before = await prisma.passwordResetToken.findUniqueOrThrow({ where: { userId: alice.id } });

    const result = await issuePasswordReset(alice.email);

    expect(result).toEqual({ status: 'cooldown' });
    expect(await prisma.passwordResetToken.findUniqueOrThrow({ where: { userId: alice.id } })).toEqual(before);
    expect((await resetPasswordWithToken(token, 'new-hash')).status).toBe('reset');
  });

  it('lets only one of two simultaneous requests issue a link', async () => {
    // Two requests do not always overlap (without the row lock they did on about 9 runs in 10), so
    // the race is tried on several accounts, which makes a missing lock fail every time.
    for (let round = 1; round <= RACE_ROUNDS; round++) {
      const alice = await createVerifiedUser('Alice');

      const results = await Promise.all([issuePasswordReset(alice.email), issuePasswordReset(alice.email)]);

      expect(results.map((result) => result.status).sort(), `round ${round}`).toEqual(['cooldown', 'reset_link']);
      expect(await prisma.passwordResetToken.count({ where: { userId: alice.id } })).toBe(1);
      const issued = results.find((result) => result.status === 'reset_link');
      if (issued?.status !== 'reset_link') throw new Error('unreachable');
      expect((await prisma.passwordResetToken.findUniqueOrThrow({ where: { userId: alice.id } })).tokenHash).toBe(
        hashToken(issued.token)
      );
    }
  });

  it('answers an unknown address with a result of its own and stores nothing', async () => {
    await createVerifiedUser('Alice');

    expect(await issuePasswordReset('nobody@example.com')).toEqual({ status: 'unknown_email' });
    expect(await prisma.passwordResetToken.count()).toBe(0);
    expect(await prisma.emailVerificationToken.count()).toBe(0);
  });

  it('matches the address exactly, like login: another spelling of the case is another address', async () => {
    const alice = await createVerifiedUser('Alice');
    await prisma.user.update({ where: { id: alice.id }, data: { email: 'Alice.Smith@example.com' } });

    expect(await issuePasswordReset('alice.smith@example.com')).toEqual({ status: 'unknown_email' });
    expect((await issuePasswordReset('Alice.Smith@example.com')).status).toBe('reset_link');
  });

  it('sends an unverified account the verification link instead, and stores no reset link', async () => {
    const alice = await createUser('Alice');
    const now = new Date();

    const result = await issuePasswordReset(alice.email, now);

    expect(result).toMatchObject({ status: 'verification_link', email: alice.email });
    if (result.status !== 'verification_link') throw new Error('unreachable');
    expect(await prisma.passwordResetToken.count()).toBe(0);
    const stored = await prisma.emailVerificationToken.findUniqueOrThrow({ where: { userId: alice.id } });
    expect(stored).toMatchObject({ email: alice.email, tokenHash: hashToken(result.token), createdAt: now });
    // It is the same link POST /account/email/verification would have sent: it verifies the address.
    expect(await verifyEmailToken(result.token)).toEqual({ status: 'verified' });
  });

  it('applies the verification cooldown to an unverified account, and leaves its link alone', async () => {
    const alice = await createUser('Alice');
    const token = await createVerificationLink(alice, { createdAt: new Date(Date.now() - 5_000) });
    const before = await prisma.emailVerificationToken.findUniqueOrThrow({ where: { userId: alice.id } });

    const result = await issuePasswordReset(alice.email);

    expect(result).toEqual({ status: 'cooldown' });
    expect(await prisma.emailVerificationToken.findUniqueOrThrow({ where: { userId: alice.id } })).toEqual(before);
    expect(await prisma.passwordResetToken.count()).toBe(0);
    expect(await verifyEmailToken(token)).toEqual({ status: 'verified' });
  });

  it('ignores a stale reset link of an account that is not verified (no reset link is ever mailed to it)', async () => {
    const alice = await createUser('Alice');
    await createResetLink(alice, { createdAt: new Date(Date.now() - 2 * RESET_REQUEST_COOLDOWN_MS) });

    const result = await issuePasswordReset(alice.email);

    expect(result.status).toBe('verification_link');
  });

  it('only ever writes the requested account\'s own link', async () => {
    const alice = await createVerifiedUser('Alice');
    const bob = await createVerifiedUser('Bob');
    const bobsToken = await createResetLink(bob, { createdAt: new Date(Date.now() - 2 * RESET_REQUEST_COOLDOWN_MS) });

    await issuePasswordReset(alice.email);

    expect((await prisma.passwordResetToken.findUniqueOrThrow({ where: { userId: bob.id } })).tokenHash).toBe(
      hashToken(bobsToken)
    );
    expect(await prisma.passwordResetToken.count({ where: { userId: alice.id } })).toBe(1);
  });
});

describe('resetPasswordWithToken', () => {
  it("stores the new hash, consumes the link and deletes all of the account's sessions, expired ones too, and nobody else's", async () => {
    const alice = await createVerifiedUser('Alice');
    const bob = await createVerifiedUser('Bob');
    const token = await createResetLink(alice);
    const bobsToken = await createResetLink(bob);
    await createSessionRow(alice.id, new Date(Date.now() + 60_000));
    await createSessionRow(alice.id, new Date(Date.now() + 60_000));
    await createSessionRow(alice.id, new Date(Date.now() - 1000));
    await createSessionRow(bob.id, new Date(Date.now() + 60_000));

    const result = await resetPasswordWithToken(token, 'the-new-hash');

    expect(result).toEqual({ status: 'reset', email: alice.email });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: alice.id } })).passwordHash).toBe('the-new-hash');
    expect(await prisma.session.count({ where: { userId: alice.id } })).toBe(0);
    expect(await prisma.passwordResetToken.count({ where: { userId: alice.id } })).toBe(0);
    // Bob's account, session and link are untouched.
    expect((await prisma.user.findUniqueOrThrow({ where: { id: bob.id } })).passwordHash).toBe(bob.passwordHash);
    expect(await prisma.session.count({ where: { userId: bob.id } })).toBe(1);
    expect(await prisma.passwordResetToken.findUniqueOrThrow({ where: { userId: bob.id } })).toMatchObject({
      tokenHash: hashToken(bobsToken),
    });
  });

  it('lets a link work until the moment it expires, and not at that moment', async () => {
    const alice = await createVerifiedUser('Alice');
    const bob = await createVerifiedUser('Bob');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    const alicesToken = await createResetLink(alice, { expiresAt });
    const bobsToken = await createResetLink(bob, { expiresAt });

    const atTheLastMoment = await resetPasswordWithToken(alicesToken, 'new-hash', new Date(expiresAt.getTime() - 1));
    const atExpiry = await resetPasswordWithToken(bobsToken, 'new-hash', expiresAt);

    expect(atTheLastMoment.status).toBe('reset');
    expect(atExpiry).toEqual({ status: 'invalid' });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: bob.id } })).passwordHash).toBe(bob.passwordHash);
    // An expired row stays until the user asks for a new link (at most one per user).
    expect(await prisma.passwordResetToken.count({ where: { userId: bob.id } })).toBe(1);
  });

  it('lets only one of two simultaneous requests with the same link reset', async () => {
    // Tried on several accounts, because two requests do not always overlap (see issuePasswordReset's test).
    for (let round = 1; round <= RACE_ROUNDS; round++) {
      const alice = await createVerifiedUser('Alice');
      const token = await createResetLink(alice);

      const results = await Promise.all([resetPasswordWithToken(token, 'hash-a'), resetPasswordWithToken(token, 'hash-b')]);

      expect(results.map((result) => result.status).sort(), `round ${round}`).toEqual(['invalid', 'reset']);
      const stored = (await prisma.user.findUniqueOrThrow({ where: { id: alice.id } })).passwordHash;
      expect(['hash-a', 'hash-b']).toContain(stored);
    }
  });

  it('does not accept a link that a newer one replaced', async () => {
    const alice = await createVerifiedUser('Alice');
    const oldToken = await createResetLink(alice, { createdAt: new Date(Date.now() - 2 * RESET_REQUEST_COOLDOWN_MS) });
    const issued = await issuePasswordReset(alice.email);
    if (issued.status !== 'reset_link') throw new Error('unreachable');

    expect(await resetPasswordWithToken(oldToken, 'new-hash')).toEqual({ status: 'invalid' });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: alice.id } })).passwordHash).toBe(alice.passwordHash);
    expect((await resetPasswordWithToken(issued.token, 'new-hash')).status).toBe('reset');
  });

  it('refuses an unknown token, and does not accept the stored hash as if it were the token', async () => {
    const alice = await createVerifiedUser('Alice');
    const token = await createResetLink(alice);
    const { tokenHash } = await prisma.passwordResetToken.findUniqueOrThrow({ where: { userId: alice.id } });

    expect(tokenHash).toBe(hashToken(token));
    expect(await resetPasswordWithToken('not-a-token', 'new-hash')).toEqual({ status: 'invalid' });
    expect(await resetPasswordWithToken(tokenHash, 'new-hash')).toEqual({ status: 'invalid' });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: alice.id } })).passwordHash).toBe(alice.passwordHash);
    expect(await prisma.passwordResetToken.count()).toBe(1);
  });

  it('rolls everything back when a step fails, so the link survives and works afterwards', async () => {
    const alice = await createVerifiedUser('Alice');
    await createSessionRow(alice.id, new Date(Date.now() + 60_000));
    const token = await createResetLink(alice);

    // Postgres refuses a NUL character in text, which fails the step that stores the hash, after
    // the link has been claimed.
    await expect(resetPasswordWithToken(token, 'bad\u0000hash')).rejects.toThrow();

    expect(await prisma.passwordResetToken.count({ where: { userId: alice.id } })).toBe(1);
    expect(await prisma.session.count({ where: { userId: alice.id } })).toBe(1);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: alice.id } })).passwordHash).toBe(alice.passwordHash);
    expect((await resetPasswordWithToken(token, 'good-hash')).status).toBe('reset');
  });
});
