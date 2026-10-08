import { describe, expect, it } from 'vitest';
import { generateToken, hashToken } from '../../src/lib/randomToken';

describe('generateToken', () => {
  it('is 32 random bytes as base64url: 43 characters that are safe in a cookie and a URL', () => {
    expect(generateToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('is different every time', () => {
    const tokens = new Set(Array.from({ length: 1000 }, () => generateToken()));

    expect(tokens.size).toBe(1000);
  });
});

describe('hashToken', () => {
  it('is the SHA-256 of the token as 64 hex characters', () => {
    // The standard SHA-256 test vector for "abc".
    expect(hashToken('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('is the same for the same token, and never the token itself', () => {
    const token = generateToken();

    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token)).not.toContain(token);
    expect(hashToken(token)).not.toBe(hashToken(generateToken()));
  });
});
