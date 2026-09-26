import { prisma } from '../../lib/prisma';

/**
 * Deletes chat rooms that have stayed empty for longer than the retention
 * period. Deleting a room cascades to its messages (onDelete: Cascade in the
 * schema). Called on a timer by chatRoomCleanup.job.ts.
 *
 * Two steps, so the cleanup doesn't depend on every code path remembering to
 * stamp a room when it empties:
 *
 * 1. Stamp: a room with no members and no `emptiedAt` (for example one whose
 *    members' accounts were all deleted, since that removes their memberships
 *    without going through DELETE /chat/:chatid/member/:userid) gets
 *    `emptiedAt = now`. The retention clock starts here, so such a room is
 *    never deleted in the same run that discovers it.
 * 2. Delete: rooms whose `emptiedAt` is older than the retention period.
 *    `members: { none: {} }` is repeated in this delete on purpose - a room
 *    that somehow has members again is never deleted, whatever its stamp says.
 *
 * There's no step for "a stamped room gained members again" because it can't
 * happen through the API: every /chat/:chatid route requires the
 * requester to be a member, so nobody can reach an empty room to join or
 * add anyone to it.
 */
export async function purgeExpiredEmptyChatRooms(
  retentionMs: number,
  now: Date = new Date()
): Promise<{ stamped: number; deleted: number }> {
  const stamped = await prisma.chatRoom.updateMany({
    where: { emptiedAt: null, members: { none: {} } },
    data: { emptiedAt: now },
  });

  const cutoff = new Date(now.getTime() - retentionMs);
  const deleted = await prisma.chatRoom.deleteMany({
    where: { emptiedAt: { lte: cutoff }, members: { none: {} } },
  });

  return { stamped: stamped.count, deleted: deleted.count };
}
