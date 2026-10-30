import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { verifyPassword } from '../../src/lib/passwordHash';
import { prisma } from '../../src/lib/prisma';
import { PRIVATE_ROOM_BOT_EMAIL } from '../../src/modules/chatrooms/privateRoom.service';
import { createGroupRoom, createPrivateRoom, findBot } from '../helpers/chatRooms';
import { createUser } from '../helpers/users';

// What the migration add_private_chat_room does for accounts that existed before it: the bot, and the
// block between its "backfill" markers, run here against test data.

const migration = readFileSync(
  resolve(import.meta.dirname, '../../prisma/migrations/20261026090000_add_private_chat_room/migration.sql'),
  'utf8',
);
const backfill = migration.slice(
  migration.indexOf('-- backfill: start') + '-- backfill: start'.length,
  migration.indexOf('-- backfill: end'),
);

const privateRoomsOf = async (userId: number, botId: number) =>
  prisma.chatRoom.findMany({
    where: { AND: [{ members: { some: { memberId: userId } } }, { members: { some: { memberId: botId } } }] },
    include: { members: true },
  });

describe('the bot the migration made', () => {
  it('cannot receive mail, is not a phone number, and has a password nobody knows', async () => {
    const bot = await findBot();

    expect(bot).toMatchObject({
      name: 'My Documents',
      email: PRIVATE_ROOM_BOT_EMAIL,
      tel: 'bot:my-documents',
      isBot: true,
      emailVerifiedAt: null,
    });
    expect(bot.email.endsWith('.invalid')).toBe(true);
    expect(bot.passwordHash).toMatch(/^\$argon2id\$/);
    // A real hash: checking a password against it answers false rather than throwing.
    expect(await verifyPassword(bot.passwordHash, 'Str0ng!Pass')).toBe(false);
  });
});

describe('the bot the migration protected', () => {
  // If the trigger were missing these tests would delete the bot, and every later test would fail for
  // want of it: the row is put back, so the one broken guard is the one failure that is reported.
  async function keepingTheBot(run: (bot: Awaited<ReturnType<typeof findBot>>) => Promise<void>) {
    const bot = await findBot();
    try {
      await run(bot);
    } finally {
      if ((await prisma.user.count({ where: { id: bot.id } })) === 0) await prisma.user.create({ data: bot });
    }
  }

  it('cannot be deleted, however the delete gets to the database, and its rooms stay whole', () =>
    keepingTheBot(async (bot) => {
      const alice = await createUser('Alice');
      const room = await createPrivateRoom(alice.id);

      await expect(prisma.user.delete({ where: { id: bot.id } })).rejects.toThrow(/cannot be deleted/);
      await expect(prisma.user.deleteMany({ where: { isBot: true } })).rejects.toThrow(/cannot be deleted/);
      await expect(prisma.$executeRaw`DELETE FROM users WHERE id = ${bot.id}`).rejects.toThrow(/cannot be deleted/);

      expect(await prisma.user.count({ where: { id: bot.id } })).toBe(1);
      expect(await prisma.chatMember.count({ where: { chatId: room.id } })).toBe(2);
    }));

  it('does not stop the deletion of any other user, and a statement that includes the bot deletes nobody', () =>
    keepingTheBot(async (bot) => {
      const alice = await createUser('Alice');
      const bea = await createUser('Bea');

      await prisma.user.delete({ where: { id: alice.id } });
      await expect(prisma.user.deleteMany({ where: { id: { in: [bea.id, bot.id] } } })).rejects.toThrow(/cannot be deleted/);

      expect(await prisma.user.count({ where: { id: alice.id } })).toBe(0);
      expect(await prisma.user.count({ where: { id: bea.id } })).toBe(1); // the statement was refused as a whole
    }));
});

describe('the backfill', () => {
  it('gives every account without one a private room, and leaves the rest alone', async () => {
    const bot = await findBot();
    const alice = await createUser('Alice');
    const bea = await createUser('Bea');
    const carl = await createUser('Carl');
    const carlsRoom = await createPrivateRoom(carl.id);
    const group = await createGroupRoom(alice.id, [bea.id]);

    await prisma.$executeRawUnsafe(backfill);

    for (const user of [alice, bea, carl]) {
      const rooms = await privateRoomsOf(user.id, bot.id);
      expect(rooms).toHaveLength(1);
      expect(rooms[0]).toMatchObject({ type: 'direct', name: null, avatarUrl: null, emptiedAt: null });
      expect(rooms[0]!.members.map(({ memberId, role }) => [memberId, role]).sort()).toEqual(
        [
          [user.id, 'admin'],
          [bot.id, 'admin'],
        ].sort(),
      );
    }
    expect((await privateRoomsOf(carl.id, bot.id))[0]!.id).toBe(carlsRoom.id);
    expect(await privateRoomsOf(bot.id, bot.id)).toHaveLength(3);
    expect(await prisma.chatMember.count({ where: { chatId: group.id } })).toBe(2);
    expect(await prisma.chatRoom.count()).toBe(4);
  });

  it('can run again without making a second room for anyone', async () => {
    const alice = await createUser('Alice');
    const bot = await findBot();

    await prisma.$executeRawUnsafe(backfill);
    await prisma.$executeRawUnsafe(backfill);

    expect(await privateRoomsOf(alice.id, bot.id)).toHaveLength(1);
    expect(await prisma.chatRoom.count()).toBe(1);
  });

  it('does nothing when there are no accounts, and gives the bot no room of its own', async () => {
    await prisma.$executeRawUnsafe(backfill);

    expect(await prisma.chatRoom.count()).toBe(0);
  });
});
