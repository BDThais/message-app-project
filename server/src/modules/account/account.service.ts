import { ChatMemberRole, ChatRoomType } from '../../generated/prisma/client';
import { prisma } from '../../lib/prisma';

export function findExistingUser(email: string, tel: string) {
	return prisma.user.findFirst({
		where: {
			OR: [{ email }, { tel }]
		}
	});
}

export function findUserByEmail(email: string) {
	return prisma.user.findUnique({ where: { email } });
}

export function createUser(data: {
	name: string;
	email: string;
	tel: string;
	passwordHash: string;
}) {
	return prisma.user.create({ data });
}

// The public shape of a user, as returned by login, GET /account/me and
// PATCH /account/me. Never includes passwordHash.
const userSelect = { id: true, name: true, email: true, tel: true, avatarUrl: true } as const;

/** Updates the profile fields that were sent and returns the user. */
export function updateUserProfile(userId: number, data: { name?: string; avatarUrl?: string | null }) {
	return prisma.user.update({ where: { id: userId }, data, select: userSelect });
}

/** The stored password hash, or null when the account no longer exists. */
export async function findPasswordHash(userId: number): Promise<string | null> {
	const user = await prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });

	return user?.passwordHash ?? null;
}

/**
 * Replaces the password and signs the account out everywhere except the
 * session making the change, in one transaction: the new hash is never stored
 * while a leaked session still works, and the old sessions are never deleted
 * while the old password still stands.
 *
 * `oldPasswordHash` is the hash the caller verified. If the stored hash is no
 * longer that one (the password was changed by another request in the
 * meantime, or the account is gone) nothing is written and the result is
 * false, so a stale "current password" cannot overwrite a newer one.
 */
export function changePassword(
	userId: number,
	oldPasswordHash: string,
	newPasswordHash: string,
	currentSessionId: string
): Promise<boolean> {
	return prisma.$transaction(async (tx) => {
		const updated = await tx.user.updateMany({
			where: { id: userId, passwordHash: oldPasswordHash },
			data: { passwordHash: newPasswordHash },
		});
		if (updated.count === 0) return false;

		await tx.session.deleteMany({ where: { userId, id: { not: currentSessionId } } });
		return true;
	});
}

export type DeleteAccountResult =
	| { status: 'deleted' }
	// Refused: the user is the only admin of these group rooms, which still have other members.
	| { status: 'only_admin'; chatIds: number[] }
	// The stored hash is no longer the one the caller verified (the password was changed in the
	// meantime) or the account is already gone, so nothing was deleted.
	| { status: 'stale_password' };

/**
 * Deletes the account (DELETE /account/me). The foreign keys do the rest in
 * the same statement: the user's sessions, room memberships, friend-list
 * entries and friend requests (sent and received) are deleted with the user,
 * while their messages stay in the room with `senderId` set to null.
 *
 * Business rule enforced here: a group room that still has members must
 * always keep at least one admin (see removeMemberFromChatRoom), so the
 * account of a room's only admin cannot be deleted while other members remain.
 * The result lists those rooms, and nothing is deleted at all, so the user
 * can promote someone (or delete the room) and try again. Direct rooms are
 * exempt, and so are group rooms where the user is the only member.
 *
 * A room the user was the only member of is stamped with `emptiedAt` in the
 * same transaction, as removeMemberFromChatRoom does when the last member
 * leaves, so the retention clock of the cleanup job starts right away.
 *
 * Every room the user is in is locked (SELECT ... FOR UPDATE, in id order so
 * two deletions that share rooms cannot deadlock) before the check, for the
 * reason given in removeMemberFromChatRoom: without it, two admins of the same
 * room deleting their accounts at the same moment could each still see the
 * other as an admin and both succeed, leaving members and no admin.
 *
 * `passwordHash` is the hash the caller verified. As in changePassword, if the
 * stored hash is no longer that one nothing is deleted.
 */
export function deleteAccount(userId: number, passwordHash: string): Promise<DeleteAccountResult> {
	return prisma.$transaction(async (tx) => {
		await tx.$queryRaw`
			SELECT id FROM chat_rooms
			WHERE id IN (SELECT chat_id FROM chat_members WHERE member_id = ${userId})
			ORDER BY id
			FOR UPDATE
		`;

		// A group room where the user is an admin, somebody else is still a member,
		// and none of those others is an admin.
		const blockingRooms = await tx.chatMember.findMany({
			where: {
				memberId: userId,
				role: ChatMemberRole.admin,
				chatRoom: {
					type: ChatRoomType.group,
					members: { some: { memberId: { not: userId } } },
					NOT: { members: { some: { memberId: { not: userId }, role: ChatMemberRole.admin } } },
				},
			},
			select: { chatId: true },
			orderBy: { chatId: 'asc' },
		});
		if (blockingRooms.length > 0) {
			return { status: 'only_admin', chatIds: blockingRooms.map((room) => room.chatId) };
		}

		const soloRooms = await tx.chatRoom.findMany({
			where: { members: { some: { memberId: userId }, none: { memberId: { not: userId } } } },
			select: { id: true },
		});

		const deleted = await tx.user.deleteMany({ where: { id: userId, passwordHash } });
		if (deleted.count === 0) return { status: 'stale_password' };

		await tx.chatRoom.updateMany({
			where: { id: { in: soloRooms.map((room) => room.id) } },
			data: { emptiedAt: new Date() },
		});
		return { status: 'deleted' };
	});
}
