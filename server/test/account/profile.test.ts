import { describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { createUser, loginAs } from '../helpers/users';

const route = '/account/me';

describe(`PATCH ${route}`, () => {
  it('returns 401 without a session', async () => {
    const res = await request(app).patch(route).send({ name: 'Alice2' });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Unauthorized Access' });
  });

  it('returns 400 for an invalid body and changes nothing', async () => {
    const alice = await createUser('Alice');
    const agent = await loginAs(alice);

    const res = await agent.patch(route).send({});

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "At least either 'name' or 'avatar_url' must be provided" });
    expect(await prisma.user.findUnique({ where: { id: alice.id } })).toEqual(alice);
  });

  it('changes the name and leaves everything else alone', async () => {
    const alice = await createUser('Alice');
    const agent = await loginAs(alice);

    const res = await agent.patch(route).send({ name: 'Alice2' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      user: { id: alice.id, name: 'Alice2', email: alice.email, tel: alice.tel, avatarUrl: null },
    });
    expect(res.body.user.passwordHash).toBeUndefined();
    expect(await prisma.user.findUnique({ where: { id: alice.id } })).toEqual({ ...alice, name: 'Alice2' });
  });

  it('sets the avatar, shows it in GET /account/me, and clears it with null', async () => {
    const alice = await createUser('Alice');
    const agent = await loginAs(alice);
    const avatarUrl = 'https://example.com/alice.png';

    const set = await agent.patch(route).send({ avatar_url: avatarUrl });
    const me = await agent.get(route);

    expect(set.status).toBe(200);
    expect(set.body.user).toMatchObject({ name: 'Alice', avatarUrl });
    expect(me.body.user).toEqual({ id: alice.id, name: 'Alice', email: alice.email, tel: alice.tel, avatarUrl });

    const cleared = await agent.patch(route).send({ avatar_url: null });

    expect(cleared.status).toBe(200);
    expect(cleared.body.user.avatarUrl).toBeNull();
    expect((await prisma.user.findUnique({ where: { id: alice.id } }))!.avatarUrl).toBeNull();
  });

  it('only changes the field that was sent', async () => {
    const alice = await createUser('Alice');
    await prisma.user.update({ where: { id: alice.id }, data: { avatarUrl: 'https://example.com/a.png' } });
    const agent = await loginAs(alice);

    const res = await agent.patch(route).send({ name: 'Alice2' });

    expect(res.body.user).toMatchObject({ name: 'Alice2', avatarUrl: 'https://example.com/a.png' });
  });

  it("never touches another user's profile", async () => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');
    const agent = await loginAs(alice);

    await agent.patch(route).send({ name: 'Alice2', avatar_url: 'https://example.com/a.png' });

    expect(await prisma.user.findUnique({ where: { id: bob.id } })).toEqual(bob);
  });
});
