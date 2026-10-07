import dotenv from 'dotenv';
import { resolve } from 'node:path';
import { afterAll, beforeEach } from 'vitest';
import { setMailer } from '../src/lib/mailer';
import { outbox } from './helpers/mailer';

dotenv.config({ path: resolve(import.meta.dirname, '../.env.test') });

if (process.env.NODE_ENV !== 'test') {
  throw new Error('Integration tests require NODE_ENV=test.');
}

if (!process.env.DATABASE_URL?.endsWith('/chatapp_test')) {
  throw new Error('Integration tests require the chatapp_test database.');
}

const { prisma } = await import('../src/lib/prisma');

// No test sends or logs a real mail: whatever the app sends lands in `outbox`.
setMailer(outbox);

beforeEach(async () => {
  outbox.clear();
  await prisma.$transaction([
    prisma.friendListMember.deleteMany(),
    prisma.pendingFriendRequest.deleteMany(),
    prisma.chatMember.deleteMany(),
    prisma.message.deleteMany(),
    prisma.session.deleteMany(),
    prisma.emailVerificationToken.deleteMany(),
    prisma.chatRoom.deleteMany(),
    prisma.user.deleteMany(),
  ]);
});

afterAll(async () => {
  await prisma.$disconnect();
});