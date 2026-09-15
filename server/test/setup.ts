import dotenv from 'dotenv';
import { resolve } from 'node:path';
import { afterAll, beforeEach } from 'vitest';

dotenv.config({ path: resolve(import.meta.dirname, '../.env.test') });

if (process.env.NODE_ENV !== 'test') {
  throw new Error('Integration tests require NODE_ENV=test.');
}

if (!process.env.DATABASE_URL?.endsWith('/chatapp_test')) {
  throw new Error('Integration tests require the chatapp_test database.');
}

const { prisma } = await import('../src/lib/prisma');

beforeEach(async () => {
  await prisma.$transaction([
    prisma.friendListMember.deleteMany(),
    prisma.pendingFriendRequest.deleteMany(),
    prisma.chatMember.deleteMany(),
    prisma.message.deleteMany(),
    prisma.session.deleteMany(),
    prisma.chatRoom.deleteMany(),
    prisma.user.deleteMany(),
  ]);
});

afterAll(async () => {
  await prisma.$disconnect();
});