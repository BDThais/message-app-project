import type { MailMessage } from '../../src/lib/mailer';
import { prisma } from '../../src/lib/prisma';
import { generateToken, hashToken } from '../../src/lib/randomToken';

/** The token in the link of a verification mail (`...#token=<token>`). */
export function tokenFromMail(mail: MailMessage): string {
  const match = /#token=([A-Za-z0-9_-]+)/.exec(mail.text);
  if (!match) throw new Error(`No verification link in this mail: ${mail.text}`);

  return match[1];
}

/**
 * Stores a verification link for `user` (replacing none: a user has at most
 * one) and returns its token, as the mail would carry it. By default it is for
 * the user's own address, was made just now and is valid for an hour; each of
 * those can be set to put the link in a particular state.
 */
export async function createVerificationLink(
  user: { id: number; email: string },
  options: { email?: string; createdAt?: Date; expiresAt?: Date } = {}
): Promise<string> {
  const token = generateToken();

  await prisma.emailVerificationToken.create({
    data: {
      userId: user.id,
      email: options.email ?? user.email,
      tokenHash: hashToken(token),
      createdAt: options.createdAt ?? new Date(),
      expiresAt: options.expiresAt ?? new Date(Date.now() + 60 * 60 * 1000),
    },
  });

  return token;
}
