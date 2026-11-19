import { spawnSync } from 'node:child_process';
import path from 'node:path';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import app from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { createVerifiedUser } from '../../src/modules/account/verifiedUser.service';
import { createUser } from '../helpers/users';

const valid = { name: 'DemoOne', email: 'Demo1@Example.com', tel: '+84901234567', password: 'Str0ng!Pass' };

describe('createVerifiedUser', () => {
  it('makes an account that can sign in at once, with no mail and no link left', async () => {
    const result = await createVerifiedUser(valid);

    expect(result).toEqual({
      status: 'created',
      user: { id: expect.any(Number), name: 'DemoOne', email: 'demo1@example.com' },
    });
    const login = await request(app)
      .post('/api/account/login')
      .send({ email: 'demo1@example.com', password: 'Str0ng!Pass' });
    expect(login.status).toBe(200);
    expect(login.body.user.email).toBe('demo1@example.com');
    expect(await prisma.emailVerificationToken.count()).toBe(0);
  });

  it('stores the address and the number as signup does: the address in lower case, the number in international form', async () => {
    await createVerifiedUser({ ...valid, tel: '+84 90 123 4567' });

    const stored = await prisma.user.findUniqueOrThrow({ where: { email: 'demo1@example.com' } });
    expect(stored.tel).toBe('+84901234567');
    expect(stored.emailVerifiedAt).not.toBeNull();
  });

  it('gives the account its private chat room, like signup', async () => {
    const result = await createVerifiedUser(valid);
    if (result.status !== 'created') throw new Error('not created');

    expect(await prisma.chatMember.count({ where: { memberId: result.user.id } })).toBe(1);
  });

  it.each([
    ['a name with a space', { name: 'Demo One' }, /Name must contain only letters and numbers/],
    ['a weak password', { password: 'password' }, /Password/],
    ['a phone number that is not one', { tel: '12345' }, /phone/i],
    ['an address that is not one', { email: 'not-an-email' }, /email/i],
  ])('refuses %s with the reason, and creates nothing', async (_label, override, message) => {
    const result = await createVerifiedUser({ ...valid, ...override });

    expect(result.status).toBe('invalid');
    expect(result).toEqual({ status: 'invalid', message: expect.stringMatching(message) });
    expect(await prisma.user.count()).toBe(0);
  });

  it('refuses an address or a number that belongs to an account already, and leaves that account alone', async () => {
    const taken = await createUser('Taken');

    const sameEmail = await createVerifiedUser({ ...valid, email: taken.email });
    const sameTel = await createVerifiedUser({ ...valid, tel: taken.tel });

    expect(sameEmail.status).toBe('duplicate');
    expect(sameTel.status).toBe('duplicate');
    expect(await prisma.user.count()).toBe(1);
  });

  it('answers "duplicate", and does not throw, for two calls with the same address at the same moment', async () => {
    const results = await Promise.all([createVerifiedUser(valid), createVerifiedUser(valid)]);

    expect(results.map((result) => result.status).sort()).toEqual(['created', 'duplicate']);
    expect(await prisma.user.count()).toBe(1);
  });

  it('refuses a second account with the same address, whatever its case', async () => {
    await createVerifiedUser(valid);

    const again = await createVerifiedUser({ ...valid, email: 'DEMO1@EXAMPLE.COM', tel: '+84907654321' });

    expect(again.status).toBe('duplicate');
  });
});

// The script as it is run: a separate process with the environment of the call.
describe('src/scripts/createVerifiedUser.ts', () => {
  const script = path.resolve(__dirname, '../../src/scripts/createVerifiedUser.ts');
  const run = (args: string[], password: string | undefined) =>
    spawnSync(process.execPath, ['--import', 'tsx', script, ...args], {
      env: { ...process.env, ...(password === undefined ? {} : { USER_PASSWORD: password }) },
      encoding: 'utf8',
      timeout: 30_000,
    });

  it('makes the account and says so; the same call again is refused with exit code 1', async () => {
    const first = run(['DemoTwo', 'demo2@example.com', '+84901112223'], 'Str0ng!Pass');
    expect(first.status).toBe(0);
    expect(first.stdout).toContain('Created the verified account DemoTwo <demo2@example.com>');
    expect(await prisma.user.count({ where: { email: 'demo2@example.com', emailVerifiedAt: { not: null } } })).toBe(1);

    const again = run(['DemoTwo', 'demo2@example.com', '+84901112223'], 'Str0ng!Pass');
    expect(again.status).toBe(1);
    expect(again.stderr).toContain('Not created');
  });

  it('refuses a call without the password, the name, the address or the number with exit code 2 and the usage', () => {
    for (const [args, password] of [
      [['DemoTwo', 'demo2@example.com', '+84901112223'], undefined],
      [['DemoTwo', 'demo2@example.com'], 'Str0ng!Pass'],
    ] as const) {
      const result = run([...args], password);
      expect(result.status).toBe(2);
      expect(result.stderr).toContain('Usage:');
    }
  });

  it('refuses a weak password with the reason, not a stack trace', () => {
    const result = run(['DemoTwo', 'demo2@example.com', '+84901112223'], 'weak');

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Not created: Password/);
    expect(result.stderr).not.toMatch(/\n\s+at /); // no stack frames
  });
});
