import { describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { purgeExpiredEmptyChatRooms } from '../src/services/ChatRoomCleanupServices';

const retentionMs = 7 * 24 * 60 * 60 * 1000;
const now = new Date('2026-09-20T12:00:00.000Z');

function daysAgo(days: number) {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

async function createRoom(options: { emptiedAt?: Date; withMember?: boolean } = {}) {
  const room = await prisma.chatRoom.create({
    data: { type: 'group', name: 'Project chat', ...(options.emptiedAt ? { emptiedAt: options.emptiedAt } : {}) },
  });

  if (options.withMember) {
    const user = await prisma.user.create({
      data: {
        name: `User${room.id}`,
        email: `user${room.id}@example.com`,
        tel: `+1415555${String(room.id).padStart(4, '0')}`,
        passwordHash: 'not-a-real-hash',
      },
    });
    await prisma.chatMember.create({ data: { chatId: room.id, memberId: user.id, role: 'admin' } });
    await prisma.message.create({ data: { chatId: room.id, senderId: user.id, content: 'Hello' } });
  }

  return room;
}

const roomExists = async (id: number) =>
  (await prisma.chatRoom.findUnique({ where: { id } })) !== null;

describe('purgeExpiredEmptyChatRooms', () => {
  it('deletes a room that has been empty longer than the retention period, with its messages', async () => {
    const room = await createRoom({ emptiedAt: daysAgo(8) });
    await prisma.message.create({ data: { chatId: room.id, content: 'left behind' } });

    const result = await purgeExpiredEmptyChatRooms(retentionMs, now);

    expect(result).toEqual({ stamped: 0, deleted: 1 });
    expect(await roomExists(room.id)).toBe(false);
    expect(await prisma.message.count({ where: { chatId: room.id } })).toBe(0);
  });

  it('keeps a room that emptied more recently than the retention period', async () => {
    const room = await createRoom({ emptiedAt: daysAgo(6) });

    const result = await purgeExpiredEmptyChatRooms(retentionMs, now);

    expect(result).toEqual({ stamped: 0, deleted: 0 });
    expect(await roomExists(room.id)).toBe(true);
  });

  it('only deletes the expired rooms when several are empty', async () => {
    const expired = await createRoom({ emptiedAt: daysAgo(30) });
    const recent = await createRoom({ emptiedAt: daysAgo(1) });

    const result = await purgeExpiredEmptyChatRooms(retentionMs, now);

    expect(result.deleted).toBe(1);
    expect(await roomExists(expired.id)).toBe(false);
    expect(await roomExists(recent.id)).toBe(true);
  });

  it('never deletes a room that still has members, even with an old emptiedAt stamp', async () => {
    const room = await createRoom({ emptiedAt: daysAgo(30), withMember: true });

    const result = await purgeExpiredEmptyChatRooms(retentionMs, now);

    expect(result.deleted).toBe(0);
    expect(await roomExists(room.id)).toBe(true);
    expect(await prisma.chatMember.count({ where: { chatId: room.id } })).toBe(1);
    expect(await prisma.message.count({ where: { chatId: room.id } })).toBe(1);
  });

  it('leaves rooms with members alone', async () => {
    const room = await createRoom({ withMember: true });

    const result = await purgeExpiredEmptyChatRooms(retentionMs, now);

    expect(result).toEqual({ stamped: 0, deleted: 0 });
    expect((await prisma.chatRoom.findUniqueOrThrow({ where: { id: room.id } })).emptiedAt).toBeNull();
  });

  it('starts the clock for an empty room that was never stamped instead of deleting it', async () => {
    // e.g. every member's account was deleted, which removes the memberships
    // without going through the leave endpoint.
    const room = await createRoom();

    const first = await purgeExpiredEmptyChatRooms(retentionMs, now);

    expect(first).toEqual({ stamped: 1, deleted: 0 });
    expect((await prisma.chatRoom.findUniqueOrThrow({ where: { id: room.id } })).emptiedAt).toEqual(now);
    expect(await roomExists(room.id)).toBe(true);

    // Stamping again would restart the clock every run; it must not.
    const later = new Date(now.getTime() + retentionMs - 60_000);
    expect(await purgeExpiredEmptyChatRooms(retentionMs, later)).toEqual({ stamped: 0, deleted: 0 });
    expect((await prisma.chatRoom.findUniqueOrThrow({ where: { id: room.id } })).emptiedAt).toEqual(now);

    const expired = new Date(now.getTime() + retentionMs + 60_000);
    expect(await purgeExpiredEmptyChatRooms(retentionMs, expired)).toEqual({ stamped: 0, deleted: 1 });
    expect(await roomExists(room.id)).toBe(false);
  });
});
