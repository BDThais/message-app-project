import { prisma } from '../../src/lib/prisma';

/** A finished friendship: like the accept flow, one friend-list row per direction. */
export async function makeFriends(userAId: number, userBId: number) {
  await prisma.friendListMember.createMany({
    data: [
      { userId: userAId, friendId: userBId },
      { userId: userBId, friendId: userAId },
    ],
  });
}

/**
 * A pending friend request from `senderId` to `receiverId`. Pass `createdAt`
 * when a test cares about the order of requests; otherwise it is the current time.
 */
export function createFriendRequest(senderId: number, receiverId: number, createdAt?: Date) {
  return prisma.pendingFriendRequest.create({
    data: { senderId, receiverId, ...(createdAt ? { createdAt } : {}) },
  });
}
