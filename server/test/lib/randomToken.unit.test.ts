import { describe, expect, it } from 'vitest';
import { generateToken } from '../../src/lib/randomToken';

describe('generateToken', () => {
  it('is 32 random bytes as base64url: 43 characters that are safe in a cookie and a URL', () => {
    expect(generateToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('is different every time', () => {
    const tokens = new Set(Array.from({ length: 1000 }, () => generateToken()));

    expect(tokens.size).toBe(1000);
  });
});
