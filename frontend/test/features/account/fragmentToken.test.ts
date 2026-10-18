import { describe, expect, it } from 'vitest';
import { parseFragmentToken } from '../../../src/features/account/fragmentToken';

describe('parseFragmentToken', () => {
  // What the server really mails is `#token=<base64url>` (randomBytes(32).toString('base64url')).
  it.each([
    ['#token=abc', 'abc'],
    ['token=abc', 'abc'], // some histories hand the fragment over without its #
    ['#token=Xy9_-aZ0', 'Xy9_-aZ0'],
    ['#foo=1&token=abc', 'abc'],
  ])('reads the token from %s', (hash, token) => {
    expect(parseFragmentToken(hash)).toBe(token);
  });

  it.each([[''], ['#'], ['#token='], ['#tokens=abc'], ['#other=abc']])('finds no token in %j', (hash) => {
    expect(parseFragmentToken(hash)).toBeNull();
  });
});
