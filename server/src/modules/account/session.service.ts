import { prisma } from '../../lib/prisma';
import config from '../../config/config';

// Database side of sessions. Nothing in this file knows about Express
// (no req, res or cookies), so it can be reused by other entry points such as
// the Socket.io handshake later. The cookie side lives in
// middlewares/SessionCookie.ts.

/**
 * Creates a new session row for the user and returns it, so the caller can
 * decide how to hand the session id to the client (see setSessionCookie).
 * Deletes any expired session already on file for this account first, per spec.
 * Used by POST /account/login, after the email/password check passes.
 */
export async function createSession(userId: number) {
  const expiresAt = new Date(Date.now() + config.SESSION_TTL_MS);

  await prisma.session.deleteMany({
    where: { userId, expiresAt: { lt: new Date() } },
  });

  return prisma.session.create({
    data: { userId, expiresAt },
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
  | { status: 'valid'; user: { id: number; name: string; email: string; tel: string } }
  | { status: 'expired' }
  | { status: 'missing' };

export async function findSessionUser(sessionId: string): Promise<SessionLookup> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: {
      user: {
        select: { id: true, name: true, email: true, tel: true }, // no passwordHash
      },
    },
  });

  if (!session) return { status: 'missing' };

  if (session.expiresAt < new Date()) {
    await prisma.session.delete({ where: { id: sessionId } });
    return { status: 'expired' };
  }

  return { status: 'valid', user: session.user };
}
