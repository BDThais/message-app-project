import { describe, expect, it } from 'vitest';
import { prisma } from '../../src/lib/prisma';
import { createUser, loginAs } from '../helpers/users';
import { createGroupRoom } from '../helpers/chatRooms';

// Admin-only and group-only rules are in chatRoom.permissions.test.ts; the
// full list of bad member_ids bodies is in chatRoom.validator.unit.test.ts.

describe('POST /chatrooms/:chatid/members', () => {
  it('lets an admin add several users as regular members', async () => {
    const admin = await createUser('Alice');
    const bob = await createUser('Bob');
    const carol = await createUser('Carol');
    const room = await createGroupRoom(admin.id);
    const agent = await loginAs(admin);

    const res = await agent
      .post(`/chatrooms/${room.id}/members`)
      .send({ member_ids: [bob.id, carol.id] });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      addedMembers: [
        {
          memberId: bob.id,
          chatId: room.id,
          role: 'member',
          lastReadMessageId: null,
          member: { id: bob.id, name: 'Bob', avatarUrl: null },
        },
        {
          memberId: carol.id,
          chatId: room.id,
          role: 'member',
          lastReadMessageId: null,
          member: { id: carol.id, name: 'Carol', avatarUrl: null },
        },
      ],
      alreadyMemberIds: [],
    });
    expect(await prisma.chatMember.count({ where: { chatId: room.id } })).toBe(3);
  });

  it('skips existing members without changing their role and ignores duplicate ids', async () => {
    const admin = await createUser('Alice');
    const bob = await createUser('Bob');
    const carol = await createUser('Carol');
    const room = await createGroupRoom(admin.id, [bob.id]);
    const agent = await loginAs(admin);

    const res = await agent
      .post(`/chatrooms/${room.id}/members`)
      .send({ member_ids: [admin.id, bob.id, carol.id, carol.id] });

    expect(res.status).toBe(201);
    expect(res.body.addedMembers.map((m: { memberId: number }) => m.memberId)).toEqual([carol.id]);
    expect(res.body.alreadyMemberIds).toEqual([admin.id, bob.id]);

    const roles = await prisma.chatMember.findMany({
      where: { chatId: room.id },
      orderBy: { memberId: 'asc' },
      select: { memberId: true, role: true },
    });
    expect(roles).toEqual([
      { memberId: admin.id, role: 'admin' },
      { memberId: bob.id, role: 'member' },
      { memberId: carol.id, role: 'member' },
    ]);
  });

  it('returns 200 with nothing added when everyone is already a member', async () => {
    const admin = await createUser('Alice');
    const bob = await createUser('Bob');
    const room = await createGroupRoom(admin.id, [bob.id]);
    const agent = await loginAs(admin);

    const res = await agent.post(`/chatrooms/${room.id}/members`).send({ member_ids: [bob.id] });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ addedMembers: [], alreadyMemberIds: [bob.id] });
    expect(await prisma.chatMember.count({ where: { chatId: room.id } })).toBe(2);
  });

  it('rejects unknown user ids and does not add the valid ones from the same request', async () => {
    const admin = await createUser('Alice');
    const bob = await createUser('Bob');
    const room = await createGroupRoom(admin.id);
    const agent = await loginAs(admin);

    const res = await agent
      .post(`/chatrooms/${room.id}/members`)
      .send({ member_ids: [bob.id, 999_999] });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      message: 'one or more member_ids do not refer to an existing user',
    });
    expect(await prisma.chatMember.count({ where: { chatId: room.id } })).toBe(1);
  });

  it('rejects a malformed body with 400', async () => {
    const admin = await createUser('Alice');
    const room = await createGroupRoom(admin.id);
    const agent = await loginAs(admin);

    const res = await agent.post(`/chatrooms/${room.id}/members`).send({ member_ids: [] });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ message: "'member_ids' must be a non-empty array of user IDs" });
  });
});
