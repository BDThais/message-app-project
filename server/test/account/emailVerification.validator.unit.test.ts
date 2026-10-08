import { describe, expect, it } from 'vitest';
import { validateVerifyEmailBody } from '../../src/modules/account/emailVerification.validator';

describe('validateVerifyEmailBody', () => {
  it('accepts a non-empty string token as it is, without trimming', () => {
    expect(validateVerifyEmailBody({ token: 'abc' })).toEqual({ valid: true, data: { token: 'abc' } });
    expect(validateVerifyEmailBody({ token: ' abc ' })).toEqual({ valid: true, data: { token: ' abc ' } });
  });

  it('ignores unknown fields', () => {
    expect(validateVerifyEmailBody({ token: 'abc', email: 'a@example.com' })).toEqual({ valid: true, data: { token: 'abc' } });
  });

  it.each([
    { desc: 'no body at all', body: undefined },
    { desc: 'a null body', body: null },
    { desc: 'a body that is not an object', body: 'abc' },
    { desc: 'an empty object', body: {} },
    { desc: 'an empty token', body: { token: '' } },
    { desc: 'a null token', body: { token: null } },
    { desc: 'a number', body: { token: 123 } },
    { desc: 'an array', body: { token: ['abc'] } },
    { desc: 'an object', body: { token: { value: 'abc' } } },
    { desc: 'a boolean', body: { token: true } },
  ])('rejects $desc', ({ body }) => {
    expect(validateVerifyEmailBody(body)).toEqual({ valid: false, message: 'Token is required' });
  });
});
