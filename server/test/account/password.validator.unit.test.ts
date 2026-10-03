import { describe, expect, it } from 'vitest';
import { validateChangePasswordBody } from '../../src/modules/account/password.validator';

// Pure function, so no database and no HTTP: test/account/password.test.ts
// only needs one bad-input case to prove it is wired in.

const required = 'Current password and new password are required';

describe('validateChangePasswordBody', () => {
  it('accepts a current password and a new password that follows the signup rules', () => {
    expect(validateChangePasswordBody({ current_password: 'whatever', new_password: 'N3wer!Passw0rd' })).toEqual({
      valid: true,
      data: { currentPassword: 'whatever', newPassword: 'N3wer!Passw0rd' },
    });
  });

  it.each([
    { desc: 'no body', body: undefined },
    { desc: 'an empty object', body: {} },
    { desc: 'a missing current password', body: { new_password: 'N3wer!Passw0rd' } },
    { desc: 'a missing new password', body: { current_password: 'x' } },
    { desc: 'an empty current password', body: { current_password: '', new_password: 'N3wer!Passw0rd' } },
    { desc: 'a numeric current password', body: { current_password: 123, new_password: 'N3wer!Passw0rd' } },
    { desc: 'a non-string new password', body: { current_password: 'x', new_password: ['N3wer!Passw0rd'] } },
  ])('rejects $desc', ({ body }) => {
    expect(validateChangePasswordBody(body)).toEqual({ valid: false, message: required });
  });

  it.each([
    { desc: 'too short', password: 'Ab1!', message: 'Password must be at least 8 characters long' },
    { desc: 'no uppercase letter', password: 'newer!passw0rd', message: 'Password must contain at least one uppercase letter' },
    { desc: 'no lowercase letter', password: 'NEWER!PASSW0RD', message: 'Password must contain at least one lowercase letter' },
    { desc: 'no digit', password: 'Newer!Password', message: 'Password must contain at least one number' },
    { desc: 'no special character', password: 'Newer1Password', message: 'Password must contain at least one special character' },
  ])('rejects a new password with $desc', ({ password, message }) => {
    expect(validateChangePasswordBody({ current_password: 'x', new_password: password })).toEqual({ valid: false, message });
  });
});
