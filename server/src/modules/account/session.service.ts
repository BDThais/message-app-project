import { prisma } from '../../lib/prisma';
import config from '../../config/config';
import { generateToken } from '../../lib/randomToken';
import { userSelect, toPublicUser } from './account.service';
import type { PublicUser } from './account.service';

// Database side of sessions. Nothing in this file knows about Express
// (no req, res or cookies), so it can be reused by other entry points such as
// the Socket.io handshake later. The cookie side lives in
// middlewares/SessionCookie.ts.

/** The settings (a subset of config.ts) that sessions depend on. */
export interface SessionSettings {
  SESSION_TTL_MS: number;
}

/**
 * Throws on a session lifetime that cannot work, so a bad deployment stops at
 * startup: a NaN (a mistyped value such as "7d") would make every login fail
 * with an invalid expiry date. Call it from server.ts only, like the other
 * settings checks.
 */
export function checkSessionSettings(settings: SessionSettings): void {
  const ttl = settings.SESSION_TTL_MS;
  if (!Number.isInteger(ttl) || ttl < 1 || Number.isNaN(new Date(Date.now() + ttl).getTime())) {
    throw new Error('SESSION_TTL_MS must be a whole number of milliseconds, at least 1 (the default is 604800000, 7 days)');
  }
}

/**
 * Creates a new session row for the user and returns it, so the caller can
 * decide how to hand the session id to the client (see setSessionCookie).
 * The id is 256 random bits (generateToken): it is the only thing that proves
 * who is calling, so it must not be guessable.
 * Deletes any expired session already on file for this account first, per spec.
 * Used by POST /account/login, after the email/password check passes.
 */
export async function createSession(userId: number) {
  const expiresAt = new Date(Date.now() + config.SESSION_TTL_MS);

  await prisma.session.deleteMany({
    where: { userId, expiresAt: { lt: new Date() } },
  });

  return prisma.session.create({
    data: { id: generateToken(), userId, expiresAt },
  });
}

export function deleteSession(sessionId: string) {
  return prisma.session.deleteMany({ where: { id: sessionId } });
}

/**
 * Resolves a session id to its user. The three outcomes are kept apart so the
 * caller can react differently: an expired session is deleted here, but only
 * the HTTP layer can tell the browser to drop its cookie.
 */
export type SessionLookup =
  | { status: 'valid'; user: PublicUser }
  | { status: 'expired' }
  | { status: 'missing' };

export async function findSessionUser(sessionId: string): Promise<SessionLookup> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: {
      user: {
        select: userSelect, // no passwordHash
      },
    },
  });

  if (!session) return { status: 'missing' };

  if (session.expiresAt < new Date()) {
    await prisma.session.delete({ where: { id: sessionId } });
    return { status: 'expired' };
  }

  return { status: 'valid', user: toPublicUser(session.user) };
}
