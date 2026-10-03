import { describe, expect, it } from 'vitest';
import { validateUpdateProfileBody } from '../../src/modules/account/profile.validator';

// Pure function, so no database and no HTTP: test/account/profile.test.ts only
// needs one bad-input case to prove it is wired in.

describe('validateUpdateProfileBody', () => {
  it.each([
    { desc: 'a name', body: { name: 'Alice2' }, data: { name: 'Alice2' } },
    { desc: 'an avatar', body: { avatar_url: 'https://example.com/a.png' }, data: { avatarUrl: 'https://example.com/a.png' } },
    { desc: 'a null avatar (clears it)', body: { avatar_url: null }, data: { avatarUrl: null } },
    { desc: 'both', body: { name: 'Bob', avatar_url: 'http://example.com/b.jpg' }, data: { name: 'Bob', avatarUrl: 'http://example.com/b.jpg' } },
    { desc: 'unknown fields, which are ignored', body: { name: 'Bob', email: 'x@example.com' }, data: { name: 'Bob' } },
  ])('accepts $desc', ({ body, data }) => {
    expect(validateUpdateProfileBody(body)).toEqual({ valid: true, data });
  });

  it.each([
    { desc: 'no body', body: undefined },
    { desc: 'an empty object', body: {} },
    { desc: 'only unknown fields', body: { email: 'x@example.com' } },
    { desc: 'a body that is not an object', body: 'name' },
  ])('rejects $desc', ({ body }) => {
    expect(validateUpdateProfileBody(body)).toEqual({
      valid: false,
      message: "At least either 'name' or 'avatar_url' must be provided",
    });
  });

  it.each([
    { desc: 'an empty name', body: { name: '' }, message: "'name' must be a non-empty string" },
    { desc: 'a null name', body: { name: null }, message: "'name' must be a non-empty string" },
    { desc: 'a numeric name', body: { name: 123 }, message: "'name' must be a non-empty string" },
    { desc: 'a name with a space', body: { name: 'John Doe' }, message: 'Name must contain only letters and numbers' },
    { desc: 'a name with a symbol', body: { name: 'john_doe' }, message: 'Name must contain only letters and numbers' },
    { desc: 'a numeric avatar', body: { avatar_url: 5 }, message: "'avatar_url' must be a string or null" },
    { desc: 'an avatar that is not a URL', body: { avatar_url: 'not a url' }, message: "'avatar_url' must be a valid URL" },
    { desc: 'an empty avatar', body: { avatar_url: '' }, message: "'avatar_url' must be a valid URL" },
    { desc: 'a javascript: avatar', body: { avatar_url: 'javascript:alert(1)' }, message: "'avatar_url' must be a valid URL" },
    { desc: 'a valid name next to a bad avatar', body: { name: 'Bob', avatar_url: 'ftp://example.com/a.png' }, message: "'avatar_url' must be a valid URL" },
  ])('rejects $desc', ({ body, message }) => {
    expect(validateUpdateProfileBody(body)).toEqual({ valid: false, message });
  });
});
