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
