import { describe, expect, it } from 'vitest';
import { prisma } from '../../src/lib/prisma';
import { createGroupRoom } from '../helpers/chatRooms';
import { connectSocket, openSession, useRealtimeServer } from '../helpers/realtime';
import { createUser } from '../helpers/users';

const realtime = useRealtimeServer();

describe('the socket handshake', () => {
  it('refuses a connection without a session cookie', async () => {
    await expect(connectSocket()).rejects.toThrow('Unauthorized Access');
  });

  it('refuses a cookie that names no session', async () => {
    await expect(connectSocket('session_id=not-a-session')).rejects.toThrow('Unauthorized Access');
  });

  it('refuses an expired session, and the dead row is deleted as it is by a REST request', async () => {
    const alice = await createUser('Alice');
    const { sessionId, cookie } = await openSession(alice, new Date(Date.now() - 1000));

    await expect(connectSocket(cookie)).rejects.toThrow('Unauthorized Access');
    expect(await prisma.session.findUnique({ where: { id: sessionId } })).toBeNull();
  });

  it("refuses the cookie of a session that was signed out, and accepts the person's other one", async () => {
    const alice = await createUser('Alice');
    const first = await openSession(alice);
    const second = await openSession(alice);
    await prisma.session.delete({ where: { id: first.sessionId } });

    await expect(connectSocket(first.cookie)).rejects.toThrow('Unauthorized Access');
    await expect(connectSocket(second.cookie)).resolves.toBeDefined();
  });

  it("puts the socket into the person's own room, its session's room and the room of every chat they are in", async () => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');
    const aliceRoom = await createGroupRoom(alice.id, [bob.id]);
    const bobOnlyRoom = await createGroupRoom(bob.id);
    const { sessionId, cookie } = await openSession(alice);

    await connectSocket(cookie);

    const [socket] = await realtime.io().fetchSockets();
    expect([...socket!.rooms].filter((room) => room !== socket!.id).sort()).toEqual(
      [`chat:${aliceRoom.id}`, `session:${sessionId}`, `user:${alice.id}`].sort(),
    );
    expect(socket!.rooms.has(`chat:${bobOnlyRoom.id}`)).toBe(false);
  });
});
