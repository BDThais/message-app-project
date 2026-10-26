import { describe, expect, it } from 'vitest';
import { prisma } from '../../src/lib/prisma';
import { createUser, countUsers } from '../helpers/users';

// The rules of the `users` table that the code relies on and the migrations encode.

describe('User.email (schema)', () => {
  it('refuses an address with capital letters, on insert and on update', async () => {
    const data = { name: 'Alice', tel: '+14155552671', passwordHash: 'not-a-real-hash' };
    await expect(prisma.user.create({ data: { ...data, email: 'Alice@Example.com' } })).rejects.toThrow(/users_email_lowercase_check/);

    const alice = await createUser('Alice');
    await expect(prisma.user.update({ where: { id: alice.id }, data: { email: 'Alice@Example.com' } })).rejects.toThrow(
      /users_email_lowercase_check/,
    );
    expect(await countUsers()).toBe(1);
  });

  it('keeps an address unique, and still accepts one written in lower case', async () => {
    const alice = await createUser('Alice');
    const data = { name: 'Bob', tel: '+14155552672', passwordHash: 'not-a-real-hash' };

    await expect(prisma.user.create({ data: { ...data, email: alice.email } })).rejects.toMatchObject({ code: 'P2002' });
    await expect(prisma.user.create({ data: { ...data, email: 'bob@example.com' } })).resolves.toMatchObject({ email: 'bob@example.com' });
  });
});
