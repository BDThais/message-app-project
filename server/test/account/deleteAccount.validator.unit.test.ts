import { describe, expect, it } from 'vitest';
import { validateDeleteAccountBody } from '../../src/modules/account/deleteAccount.validator';

// Pure function, so no database and no HTTP: test/account/deleteAccount.test.ts
// only needs one bad-input case to prove it is wired in.

describe('validateDeleteAccountBody', () => {
  it.each([
    { desc: 'a password', body: { password: 'Str0ng!Pass' } },
    { desc: 'a password and unknown fields, which are ignored', body: { password: 'Str0ng!Pass', email: 'x@example.com' } },
  ])('accepts $desc', ({ body }) => {
    expect(validateDeleteAccountBody(body)).toEqual({ valid: true, data: { password: 'Str0ng!Pass' } });
  });

  it.each([
    { desc: 'no body', body: undefined },
    { desc: 'a body that is not an object', body: 'Str0ng!Pass' },
    { desc: 'an empty object', body: {} },
    { desc: 'an empty password', body: { password: '' } },
    { desc: 'a password that is not a string', body: { password: 12345678 } },
    { desc: 'a null password', body: { password: null } },
  ])('rejects $desc', ({ body }) => {
    expect(validateDeleteAccountBody(body)).toEqual({ valid: false, message: 'Password is required' });
  });
});
