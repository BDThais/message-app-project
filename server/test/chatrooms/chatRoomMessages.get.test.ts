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

    await agent.post(`/api/chat/${room.id}/message`).send({ content: 'First' });
    await agent.post(`/api/chat/${room.id}/message`).send({ content: 'Second' });
    await agent.post(`/api/chat/${room.id}/message`).send({ content: 'Third' });

    const res = await agent.get(`/api/chat/${room.id}/message`);

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
      await agent.post(`/api/chat/${room.id}/message`).send({ content });
    }

    const firstPage = await agent.get(`/api/chat/${room.id}/message?limit=2`);
    expect(firstPage.body.messages.map((m: { content: string }) => m.content)).toEqual([
      'Three',
      'Two',
    ]);
    expect(firstPage.body.hasMore).toBe(true);

    const oldestLoadedId = firstPage.body.messages[1].id;
    const secondPage = await agent.get(
      `/api/chat/${room.id}/message?before=${oldestLoadedId}&limit=2`
    );

    expect(secondPage.body.messages.map((m: { content: string }) => m.content)).toEqual(['One']);
    expect(secondPage.body.hasMore).toBe(false);
  });

  it('pages forward with after: the oldest messages above it, listed newest first, hasMore meaning newer ones remain', async () => {
    const user = await createUser('Alice');
    const room = await createGroupRoom(user.id);
    const agent = await loginAs(user);
    const ids: number[] = [];
    for (const content of ['One', 'Two', 'Three', 'Four', 'Five']) {
      ids.push((await agent.post(`/api/chat/${room.id}/message`).send({ content })).body.message.id);
    }
    const contents = (res: { body: { messages: { content: string }[] } }) => res.body.messages.map((m) => m.content);

    const first = await agent.get(`/api/chat/${room.id}/message?after=${ids[0]}&limit=2`);
    expect(first.status).toBe(200);
    expect(contents(first)).toEqual(['Three', 'Two']);
    expect(first.body.hasMore).toBe(true);

    const second = await agent.get(`/api/chat/${room.id}/message?after=${first.body.messages[0].id}&limit=2`);
    expect(contents(second)).toEqual(['Five', 'Four']);
    expect(second.body.hasMore).toBe(false);

    const none = await agent.get(`/api/chat/${room.id}/message?after=${ids[4]}`);
    expect(none.body).toEqual({ messages: [], hasMore: false });
  });

  it('includes deleted messages when paging forward, as in every page', async () => {
    const user = await createUser('Alice');
    const room = await createGroupRoom(user.id);
    const agent = await loginAs(user);
    const first = await agent.post(`/api/chat/${room.id}/message`).send({ content: 'One' });
    const second = await agent.post(`/api/chat/${room.id}/message`).send({ content: 'Two' });
    await agent.delete(`/api/chat/${room.id}/message/${second.body.message.id}`);

    const res = await agent.get(`/api/chat/${room.id}/message?after=${first.body.message.id}`);

    expect(res.body.messages).toHaveLength(1);
    expect(res.body.messages[0]).toMatchObject({ id: second.body.message.id, content: '', deletedAt: expect.any(String) });
  });

  it('only returns the messages of this room, whatever id after names', async () => {
    const user = await createUser('Alice');
    const room = await createGroupRoom(user.id);
    const other = await createGroupRoom(user.id);
    const agent = await loginAs(user);
    await agent.post(`/api/chat/${other.id}/message`).send({ content: 'Elsewhere' });
    await agent.post(`/api/chat/${room.id}/message`).send({ content: 'Here' });

    const res = await agent.get(`/api/chat/${room.id}/message?after=1`);

    expect(res.body.messages.map((m: { content: string }) => m.content)).toEqual(['Here']);
  });

  it('lets either member of a direct room read messages', async () => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');
    const room = await createDirectRoom(alice.id, bob.id);

    const aliceAgent = await loginAs(alice);
    await aliceAgent.post(`/api/chat/${room.id}/message`).send({ content: 'Hi Bob' });

    const bobAgent = await loginAs(bob);
    const res = await bobAgent.get(`/api/chat/${room.id}/message`);

    expect(res.status).toBe(200);
    expect(res.body.messages).toHaveLength(1);
    expect(res.body.messages[0]).toMatchObject({ content: 'Hi Bob', senderId: alice.id });
  });

  it('rejects an invalid before cursor with 400', async () => {
    const user = await createUser('Alice');
    const room = await createGroupRoom(user.id);
    const agent = await loginAs(user);

    const res = await agent.get(`/api/chat/${room.id}/message?before=abc`);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "'before' must be a positive integer message id" });
  });

  it('rejects an invalid after cursor, and before together with after, with 400', async () => {
    const user = await createUser('Alice');
    const room = await createGroupRoom(user.id);
    const agent = await loginAs(user);

    const invalid = await agent.get(`/api/chat/${room.id}/message?after=abc`);
    const both = await agent.get(`/api/chat/${room.id}/message?before=5&after=3`);

    expect(invalid.status).toBe(400);
    expect(invalid.body).toEqual({ error: "'after' must be a positive integer message id" });
    expect(both.status).toBe(400);
    expect(both.body).toEqual({ error: "'before' and 'after' cannot be used together" });
  });
});
