import { describe, expect, it } from 'vitest';
import { createUser, loginAs } from '../helpers/users';
import { createDirectRoom, createGroupRoom } from '../helpers/chatRooms';

// The session/memberhip guard on this route is covered once for every route
// in chatRoom.permissions.test.ts; the full list of bad query params is in
// chatRoom.validator.unit.test.ts.

describe('GET /chat/:chatid/message', () => {
  it('returns messages newest first, with hasMore false once everything fits', async () => {
    const user = await createUser('Alice');
    const room = await createGroupRoom(user.id);
    const agent = await loginAs(user);

    await agent.post(`/chat/${room.id}/message`).send({ content: 'First' });
    await agent.post(`/chat/${room.id}/message`).send({ content: 'Second' });
    await agent.post(`/chat/${room.id}/message`).send({ content: 'Third' });

    const res = await agent.get(`/chat/${room.id}/message`);

    expect(res.status).toBe(200);
    expect(res.body.messages.map((m: { content: string }) => m.content)).toEqual([
      'Third',
      'Second',
      'First',
    ]);
    expect(res.body.hasMore).toBe(false);
  });

  it('pages backward with before and limit, reporting hasMore along the way', async () => {
    const user = await createUser('Alice');
    const room = await createGroupRoom(user.id);
    const agent = await loginAs(user);

    for (const content of ['One', 'Two', 'Three']) {
      await agent.post(`/chat/${room.id}/message`).send({ content });
    }

    const firstPage = await agent.get(`/chat/${room.id}/message?limit=2`);
    expect(firstPage.body.messages.map((m: { content: string }) => m.content)).toEqual([
      'Three',
      'Two',
    ]);
    expect(firstPage.body.hasMore).toBe(true);

    const oldestLoadedId = firstPage.body.messages[1].id;
    const secondPage = await agent.get(
      `/chat/${room.id}/message?before=${oldestLoadedId}&limit=2`
    );

    expect(secondPage.body.messages.map((m: { content: string }) => m.content)).toEqual(['One']);
    expect(secondPage.body.hasMore).toBe(false);
  });

  it('lets either member of a direct room read messages', async () => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');
    const room = await createDirectRoom(alice.id, bob.id);

    const aliceAgent = await loginAs(alice);
    await aliceAgent.post(`/chat/${room.id}/message`).send({ content: 'Hi Bob' });

    const bobAgent = await loginAs(bob);
    const res = await bobAgent.get(`/chat/${room.id}/message`);

    expect(res.status).toBe(200);
    expect(res.body.messages).toHaveLength(1);
    expect(res.body.messages[0]).toMatchObject({ content: 'Hi Bob', senderId: alice.id });
  });

  it('rejects an invalid before cursor with 400', async () => {
    const user = await createUser('Alice');
    const room = await createGroupRoom(user.id);
    const agent = await loginAs(user);

    const res = await agent.get(`/chat/${room.id}/message?before=abc`);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ message: "'before' must be a positive integer message id" });
  });
});
