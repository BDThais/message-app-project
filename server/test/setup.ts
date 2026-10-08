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

// Every test connection runs in a time zone that is not UTC (the one the developer lives in), so a time
// that goes wrong by the zone's offset fails here instead of in production: a `timestamp` column holds
// UTC, and comparing it with the database's now(), or letting a column default fill a time the code
// then compares with new Date(), is off by the offset whenever the session is not in UTC. The pg driver
// reads PGOPTIONS, so this holds for any test database (Docker or not); test/lib/testTimeZone.test.ts
// guards it.
process.env.PGOPTIONS = '-c timezone=Asia/Ho_Chi_Minh';

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