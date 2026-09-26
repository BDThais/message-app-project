import { describe, expect, it } from 'vitest';
import { prisma } from '../../src/lib/prisma';
import { createUser, loginAs } from '../helpers/users';
import { createDirectRoom, createGroupRoom, memberIdsOf, promoteToAdmin } from '../helpers/chatRooms';

// Who may remove whom, and the rule that a group room with members always
// keeps an admin. Not-a-member and not-signed-in cases for every route are in
// chatRoom.permissions.test.ts; the ':userid' format check is in
// chatRoom.validator.unit.test.ts.

const memberUrl = (chatId: number, userId: number | string) =>
  `/chat/${chatId}/member/${userId}`;

describe('DELETE /chat/:chatid/member/:userid', () => {
  describe('who may remove whom', () => {
    it('lets an admin remove a regular member', async () => {
      const admin = await createUser('Alice');
      const bob = await createUser('Bob');
      const carol = await createUser('Carol');
      const room = await createGroupRoom(admin.id, [bob.id, carol.id]);
      const agent = await loginAs(admin);

      const res = await agent.delete(memberUrl(room.id, bob.id));

      expect(res.status).toBe(204);
      expect(res.text).toBe('');
      expect(await memberIdsOf(room.id)).toEqual([admin.id, carol.id]);
    });

    it('lets a regular member leave the room', async () => {
      const admin = await createUser('Alice');
      const bob = await createUser('Bob');
      const room = await createGroupRoom(admin.id, [bob.id]);
      const agent = await loginAs(bob);

      const res = await agent.delete(memberUrl(room.id, bob.id));

      expect(res.status).toBe(204);
      expect(await memberIdsOf(room.id)).toEqual([admin.id]);
      expect((await prisma.chatRoom.findUniqueOrThrow({ where: { id: room.id } })).emptiedAt).toBeNull();
    });

    it('rejects a regular member removing someone else and removes nobody', async () => {
      const admin = await createUser('Alice');
      const bob = await createUser('Bob');
      const carol = await createUser('Carol');
      const room = await createGroupRoom(admin.id, [bob.id, carol.id]);
      const agent = await loginAs(bob);

      const removeMember = await agent.delete(memberUrl(room.id, carol.id));
      const removeAdmin = await agent.delete(memberUrl(room.id, admin.id));

      for (const res of [removeMember, removeAdmin]) {
        expect(res.status).toBe(403);
        expect(res.body).toEqual({ message: 'Admin role required for this action' });
      }
      expect(await memberIdsOf(room.id)).toEqual([admin.id, bob.id, carol.id]);
    });

    it('returns 404 when the target is not a member of the room', async () => {
      const admin = await createUser('Alice');
      const outsider = await createUser('Bob');
      const room = await createGroupRoom(admin.id);
      const agent = await loginAs(admin);

      const notAMember = await agent.delete(memberUrl(room.id, outsider.id));
      const noSuchUser = await agent.delete(memberUrl(room.id, 999_999));

      for (const res of [notAMember, noSuchUser]) {
        expect(res.status).toBe(404);
        expect(res.body).toEqual({ message: 'Member not found in this chat room' });
      }
      expect(await memberIdsOf(room.id)).toEqual([admin.id]);
    });

    it('rejects an invalid user id with 400', async () => {
      const admin = await createUser('Alice');
      const room = await createGroupRoom(admin.id);
      const agent = await loginAs(admin);

      const res = await agent.delete(memberUrl(room.id, 'abc'));

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ message: 'Invalid user id' });
      expect(await memberIdsOf(room.id)).toEqual([admin.id]);
    });
  });

  describe('the last-admin rule (group rooms)', () => {
    it('lets one of two admins leave, then stops the remaining admin while a member is left', async () => {
      const alice = await createUser('Alice');
      const bob = await createUser('Bob');
      const carol = await createUser('Carol');
      const room = await createGroupRoom(alice.id, [bob.id, carol.id]);
      await promoteToAdmin(room.id, bob.id);
      const aliceAgent = await loginAs(alice);
      const bobAgent = await loginAs(bob);

      const aliceLeaves = await aliceAgent.delete(memberUrl(room.id, alice.id));
      const bobLeaves = await bobAgent.delete(memberUrl(room.id, bob.id));

      expect(aliceLeaves.status).toBe(204);
      expect(bobLeaves.status).toBe(409);
      expect(bobLeaves.body).toEqual({
        message:
          'The only admin cannot be removed while other members remain; promote another member to admin first',
      });
      expect(await memberIdsOf(room.id)).toEqual([bob.id, carol.id]);
    });

    it('never lets two simultaneous exits leave a room with members but no admin', async () => {
      const alice = await createUser('Alice');
      const bob = await createUser('Bob');
      const carol = await createUser('Carol');
      const room = await createGroupRoom(alice.id, [bob.id, carol.id]);
      await promoteToAdmin(room.id, bob.id);
      const [aliceAgent, bobAgent] = await Promise.all([loginAs(alice), loginAs(bob)]);

      const [aliceLeaves, bobLeaves] = await Promise.all([
        aliceAgent.delete(memberUrl(room.id, alice.id)),
        bobAgent.delete(memberUrl(room.id, bob.id)),
      ]);

      expect([aliceLeaves.status, bobLeaves.status].sort()).toEqual([204, 409]);
      expect(await prisma.chatMember.count({ where: { chatId: room.id } })).toBe(2);
      expect(await prisma.chatMember.count({ where: { chatId: room.id, role: 'admin' } })).toBe(1);
    });
  });

  describe('when the last member leaves', () => {
    it('keeps the empty room and its messages, and stamps it for the cleanup job', async () => {
      const admin = await createUser('Alice');
      const room = await createGroupRoom(admin.id);
      await prisma.message.create({
        data: { chatId: room.id, senderId: admin.id, content: 'Hello' },
      });
      const agent = await loginAs(admin);
      const leftAt = Date.now();

      const res = await agent.delete(memberUrl(room.id, admin.id));

      expect(res.status).toBe(204);
      expect(await memberIdsOf(room.id)).toEqual([]);
      const emptied = await prisma.chatRoom.findUniqueOrThrow({ where: { id: room.id } });
      expect(emptied.emptiedAt).not.toBeNull();
      expect(emptied.emptiedAt!.getTime()).toBeGreaterThanOrEqual(leftAt - 1000);
      expect(await prisma.message.count({ where: { chatId: room.id } })).toBe(1);
    });
  });

  describe('in a direct room', () => {
    it('rejects removing the other member, even though both users are admins', async () => {
      const alice = await createUser('Alice');
      const bob = await createUser('Bob');
      const room = await createDirectRoom(alice.id, bob.id);
      const agent = await loginAs(alice);

      const res = await agent.delete(memberUrl(room.id, bob.id));

      expect(res.status).toBe(403);
      expect(res.body).toEqual({
        message: 'You can only remove yourself from a direct chat room',
      });
      expect(await memberIdsOf(room.id)).toEqual([alice.id, bob.id]);
    });

    it('lets each member leave without the last-admin rule getting in the way', async () => {
      const alice = await createUser('Alice');
      const bob = await createUser('Bob');
      const room = await createDirectRoom(alice.id, bob.id);
      const aliceAgent = await loginAs(alice);
      const bobAgent = await loginAs(bob);

      const aliceLeaves = await aliceAgent.delete(memberUrl(room.id, alice.id));
      expect(aliceLeaves.status).toBe(204);
      expect(await memberIdsOf(room.id)).toEqual([bob.id]);
      expect((await prisma.chatRoom.findUniqueOrThrow({ where: { id: room.id } })).emptiedAt).toBeNull();

      // Bob is now the only member (and the only admin), so nobody else is
      // left for the last-admin rule to protect.
      const bobLeaves = await bobAgent.delete(memberUrl(room.id, bob.id));
      expect(bobLeaves.status).toBe(204);
      expect(await memberIdsOf(room.id)).toEqual([]);
      expect((await prisma.chatRoom.findUniqueOrThrow({ where: { id: room.id } })).emptiedAt).not.toBeNull();
    });
  });
});
