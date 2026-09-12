import { prisma } from '../lib/prisma';

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
