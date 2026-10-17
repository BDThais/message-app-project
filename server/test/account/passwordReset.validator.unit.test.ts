import { describe, expect, it } from 'vitest';
import {
  validatePasswordResetRequestBody,
  validateResetPasswordBody,
} from '../../src/modules/account/passwordReset.validator';

// Pure functions, so no database and no HTTP: the endpoint tests only need one bad-input case each
// to prove the validator is wired in.

describe('validatePasswordResetRequestBody', () => {
  it('accepts an email and hands it on lower-cased, the spelling that is stored and looked up', () => {
    expect(validatePasswordResetRequestBody({ email: 'John.Doe@Example.com' })).toEqual({
      valid: true,
      data: { email: 'john.doe@example.com' },
    });
  });

  it('ignores unknown fields', () => {
    expect(validatePasswordResetRequestBody({ email: 'a@example.com', password: 'x' })).toEqual({
      valid: true,
      data: { email: 'a@example.com' },
    });
  });

  it.each([
    { desc: 'no body at all', body: undefined },
    { desc: 'a null body', body: null },
    { desc: 'a body that is not an object', body: 'a@example.com' },
    { desc: 'an empty object', body: {} },
    { desc: 'an empty email', body: { email: '' } },
    { desc: 'a null email', body: { email: null } },
    { desc: 'a number', body: { email: 123 } },
    { desc: 'an array', body: { email: ['a@example.com'] } },
    { desc: 'an object', body: { email: { address: 'a@example.com' } } },
  ])('rejects $desc', ({ body }) => {
    expect(validatePasswordResetRequestBody(body)).toEqual({ valid: false, message: 'Email is required' });
  });

  it.each([
    { desc: 'no @', email: 'john.example.com' },
    { desc: 'no domain', email: 'john@' },
    { desc: 'no local part', email: '@example.com' },
    { desc: 'spaces around a valid address', email: ' john@example.com ' },
    { desc: 'two @', email: 'john@@example.com' },
    { desc: 'a local part over 64 characters', email: `${'a'.repeat(65)}@example.com` },
    { desc: 'an address over 254 characters', email: `john@${'a'.repeat(250)}.com` },
  ])('rejects $desc', ({ email }) => {
    expect(validatePasswordResetRequestBody({ email })).toEqual({ valid: false, message: 'Invalid email format' });
  });
});

describe('validateResetPasswordBody', () => {
  const required = 'Token and new password are required';

  it('accepts a token as it is (no trimming) and a new password that follows the signup rules', () => {
    expect(validateResetPasswordBody({ token: ' abc ', new_password: 'N3wer!Passw0rd' })).toEqual({
      valid: true,
      data: { token: ' abc ', newPassword: 'N3wer!Passw0rd' },
    });
  });

  it('ignores unknown fields', () => {
    expect(validateResetPasswordBody({ token: 'abc', new_password: 'N3wer!Passw0rd', email: 'a@example.com' })).toEqual({
      valid: true,
      data: { token: 'abc', newPassword: 'N3wer!Passw0rd' },
    });
  });

  it.each([
    { desc: 'no body', body: undefined },
    { desc: 'a null body', body: null },
    { desc: 'an empty object', body: {} },
    { desc: 'a missing token', body: { new_password: 'N3wer!Passw0rd' } },
    { desc: 'a missing new password', body: { token: 'abc' } },
    { desc: 'an empty token', body: { token: '', new_password: 'N3wer!Passw0rd' } },
    { desc: 'an empty new password', body: { token: 'abc', new_password: '' } },
    { desc: 'a numeric token', body: { token: 123, new_password: 'N3wer!Passw0rd' } },
    { desc: 'an array token', body: { token: ['abc'], new_password: 'N3wer!Passw0rd' } },
    { desc: 'a non-string new password', body: { token: 'abc', new_password: ['N3wer!Passw0rd'] } },
    { desc: 'the field named like the change-password endpoint', body: { token: 'abc', password: 'N3wer!Passw0rd' } },
  ])('rejects $desc', ({ body }) => {
    expect(validateResetPasswordBody(body)).toEqual({ valid: false, message: required });
  });

  it.each([
    { desc: 'too short', password: 'Ab1!', message: 'Password must be at least 8 characters long' },
    { desc: 'no uppercase letter', password: 'newer!passw0rd', message: 'Password must contain at least one uppercase letter' },
    { desc: 'no lowercase letter', password: 'NEWER!PASSW0RD', message: 'Password must contain at least one lowercase letter' },
    { desc: 'no digit', password: 'Newer!Password', message: 'Password must contain at least one number' },
    { desc: 'no special character', password: 'Newer1Password', message: 'Password must contain at least one special character' },
  ])('rejects a new password with $desc, with the same message as signup', ({ password, message }) => {
    expect(validateResetPasswordBody({ token: 'abc', new_password: password })).toEqual({ valid: false, message });
  });
});
