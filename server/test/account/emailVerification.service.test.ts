import { describe, expect, it } from 'vitest';
import config from '../../src/config/config';
import { prisma } from '../../src/lib/prisma';
import { hashToken } from '../../src/lib/randomToken';
import {
  RESEND_COOLDOWN_MS,
  issueEmailVerification,
  newVerificationToken,
  verifyEmailToken,
} from '../../src/modules/account/emailVerification.service';
import { createVerificationLink } from '../helpers/emailVerification';
import { createUser } from '../helpers/users';

describe('newVerificationToken', () => {
  it('returns a token and its hash, valid for the configured time from `now`', () => {
    const now = new Date('2026-10-07T10:00:00.000Z');

    const { token, tokenHash, expiresAt } = newVerificationToken(now);

    expect(tokenHash).toBe(hashToken(token));
    expect(expiresAt.getTime()).toBe(now.getTime() + config.EMAIL_VERIFICATION_TTL_MS);
    expect(newVerificationToken(now).token).not.toBe(token);
  });
});

describe('verifyEmailToken', () => {
  it('verifies the account from `now` on and consumes the link', async () => {
    const alice = await createUser('Alice');
    const token = await createVerificationLink(alice);
    const now = new Date();

    const result = await verifyEmailToken(token, now);

    expect(result).toEqual({ status: 'verified' });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: alice.id } })).emailVerifiedAt).toEqual(now);
    expect(await prisma.emailVerificationToken.count()).toBe(0);
  });

  it('lets a link work until the moment it expires, and not at that moment', async () => {
    const alice = await createUser('Alice');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    const token = await createVerificationLink(alice, { expiresAt });

    const atTheLastMoment = await verifyEmailToken(token, new Date(expiresAt.getTime() - 1));
    expect(atTheLastMoment).toEqual({ status: 'verified' });

    const bob = await createUser('Bob');
    const bobsToken = await createVerificationLink(bob, { expiresAt });
    const atExpiry = await verifyEmailToken(bobsToken, expiresAt);

    expect(atExpiry).toEqual({ status: 'invalid' });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: bob.id } })).emailVerifiedAt).toBeNull();
    // An expired row stays until the user asks for a new link (at most one per user).
    expect(await prisma.emailVerificationToken.count({ where: { userId: bob.id } })).toBe(1);
  });

  it('lets only one of two simultaneous requests with the same link verify', async () => {
    const alice = await createUser('Alice');
    const token = await createVerificationLink(alice);

    const results = await Promise.all([verifyEmailToken(token), verifyEmailToken(token)]);

    expect(results.map((result) => result.status).sort()).toEqual(['invalid', 'verified']);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: alice.id } })).emailVerifiedAt).not.toBeNull();
  });

  it('keeps the original timestamp of an account that was verified already, and still consumes the link', async () => {
    const alice = await createUser('Alice');
    const before = new Date('2026-01-01T00:00:00.000Z');
    await prisma.user.update({ where: { id: alice.id }, data: { emailVerifiedAt: before } });
    const token = await createVerificationLink(alice);

    const result = await verifyEmailToken(token);

    expect(result).toEqual({ status: 'verified' });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: alice.id } })).emailVerifiedAt).toEqual(before);
    expect(await prisma.emailVerificationToken.count()).toBe(0);
  });

  it('refuses a link issued for another address, leaves the account unverified, and consumes the dead link', async () => {
    const alice = await createUser('Alice');
    const token = await createVerificationLink(alice, { email: 'someone.else@example.com' });

    const result = await verifyEmailToken(token);

    expect(result).toEqual({ status: 'invalid' });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: alice.id } })).emailVerifiedAt).toBeNull();
    expect(await prisma.emailVerificationToken.count()).toBe(0);
  });

  it('does not accept the stored hash as if it were the token', async () => {
    const alice = await createUser('Alice');
    const token = await createVerificationLink(alice);
    const { tokenHash } = await prisma.emailVerificationToken.findUniqueOrThrow({ where: { userId: alice.id } });

    expect(tokenHash).toBe(hashToken(token));
    expect(await verifyEmailToken(tokenHash)).toEqual({ status: 'invalid' });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: alice.id } })).emailVerifiedAt).toBeNull();
  });
});

describe('issueEmailVerification', () => {
  it('stores a link for an account that has none, and returns the token to mail', async () => {
    const alice = await createUser('Alice');
    const now = new Date();

    const result = await issueEmailVerification(alice.id, now);

    expect(result).toMatchObject({ status: 'issued', email: alice.email });
    if (result.status !== 'issued') throw new Error('unreachable');
    const stored = await prisma.emailVerificationToken.findUniqueOrThrow({ where: { userId: alice.id } });
    expect(stored).toMatchObject({ email: alice.email, tokenHash: hashToken(result.token), createdAt: now });
    expect(stored.expiresAt.getTime()).toBe(now.getTime() + config.EMAIL_VERIFICATION_TTL_MS);
    expect(await verifyEmailToken(result.token)).toEqual({ status: 'verified' });
  });

  it('replaces the old link (a new row is never added), which stops working', async () => {
    const alice = await createUser('Alice');
    const oldToken = await createVerificationLink(alice, { createdAt: new Date(Date.now() - 2 * RESEND_COOLDOWN_MS) });
    const now = new Date();

    const result = await issueEmailVerification(alice.id, now);

    expect(result.status).toBe('issued');
    expect(await prisma.emailVerificationToken.count()).toBe(1);
    expect((await prisma.emailVerificationToken.findUniqueOrThrow({ where: { userId: alice.id } })).createdAt).toEqual(now);
    expect(await verifyEmailToken(oldToken)).toEqual({ status: 'invalid' });
  });

  it('makes the cooldown last 60 seconds from the stored link, to the millisecond', async () => {
    const alice = await createUser('Alice');
    const createdAt = new Date('2026-10-07T10:00:00.000Z');
    await createVerificationLink(alice, { createdAt });

    const justBefore = await issueEmailVerification(alice.id, new Date(createdAt.getTime() + RESEND_COOLDOWN_MS - 1));
    const exactly = await issueEmailVerification(alice.id, new Date(createdAt.getTime() + RESEND_COOLDOWN_MS));

    expect(justBefore).toEqual({ status: 'cooldown' });
    expect(exactly.status).toBe('issued');
  });

  it('leaves the stored link alone while the cooldown lasts', async () => {
    const alice = await createUser('Alice');
    const token = await createVerificationLink(alice);
    const before = await prisma.emailVerificationToken.findUniqueOrThrow({ where: { userId: alice.id } });

    const result = await issueEmailVerification(alice.id);

    expect(result).toEqual({ status: 'cooldown' });
    expect(await prisma.emailVerificationToken.findUniqueOrThrow({ where: { userId: alice.id } })).toEqual(before);
    expect(await verifyEmailToken(token)).toEqual({ status: 'verified' });
  });

  it('lets only one of two simultaneous requests issue a link', async () => {
    const alice = await createUser('Alice');

    const results = await Promise.all([issueEmailVerification(alice.id), issueEmailVerification(alice.id)]);

    expect(results.map((result) => result.status).sort()).toEqual(['cooldown', 'issued']);
    expect(await prisma.emailVerificationToken.count()).toBe(1);
    const issued = results.find((result) => result.status === 'issued');
    if (issued?.status !== 'issued') throw new Error('unreachable');
    expect((await prisma.emailVerificationToken.findUniqueOrThrow({ where: { userId: alice.id } })).tokenHash).toBe(
      hashToken(issued.token)
    );
  });

  it('refuses an account that is verified already, and stores nothing', async () => {
    const alice = await createUser('Alice');
    await prisma.user.update({ where: { id: alice.id }, data: { emailVerifiedAt: new Date() } });

    const result = await issueEmailVerification(alice.id);

    expect(result).toEqual({ status: 'already_verified' });
    expect(await prisma.emailVerificationToken.count()).toBe(0);
  });

  it('reports an account that no longer exists', async () => {
    const alice = await createUser('Alice');
    await prisma.user.delete({ where: { id: alice.id } });

    expect(await issueEmailVerification(alice.id)).toEqual({ status: 'no_user' });
    expect(await prisma.emailVerificationToken.count()).toBe(0);
  });
});
