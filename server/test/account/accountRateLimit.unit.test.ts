import { describe, expect, it } from 'vitest';
import { passwordResetEmailKey } from '../../src/modules/account/accountRateLimit.middleware';

// The limiters themselves are tried through the routes (passwordResetRequestLimiter.test.ts and the
// files next to it); the key of the per-email limiter has enough rules to be checked on its own.

describe('passwordResetEmailKey', () => {
  it('is the address lower-cased, so spellings of the case share one budget', () => {
    expect(passwordResetEmailKey({ body: { email: 'John.Doe@Example.com' }, ip: '203.0.113.5' })).toBe(
      'email:john.doe@example.com'
    );
    expect(passwordResetEmailKey({ body: { email: 'JOHN.DOE@EXAMPLE.COM' }, ip: '198.51.100.7' })).toBe(
      'email:john.doe@example.com'
    );
  });

  it('does not depend on the IP when there is an address', () => {
    expect(passwordResetEmailKey({ body: { email: 'a@example.com' }, ip: '203.0.113.5' })).toBe(
      passwordResetEmailKey({ body: { email: 'a@example.com' }, ip: '198.51.100.7' })
    );
  });

  it.each([
    { desc: 'no body', body: undefined },
    { desc: 'a null body', body: null },
    { desc: 'a body that is not an object', body: 'a@example.com' },
    { desc: 'an empty object', body: {} },
    { desc: 'an email that is not a string', body: { email: ['a@example.com'] } },
    { desc: 'a null email', body: { email: null } },
    { desc: 'an email longer than any address (it must not be kept as a key)', body: { email: 'a'.repeat(255) } },
  ])('is the IP for $desc', ({ body }) => {
    expect(passwordResetEmailKey({ body, ip: '203.0.113.5' })).toBe('ip:203.0.113.5');
  });

  it('keeps an address of 254 characters (the longest there is) as a key', () => {
    const email = `${'a'.repeat(254 - '@example.com'.length)}@example.com`;

    expect(email).toHaveLength(254);
    expect(passwordResetEmailKey({ body: { email }, ip: '203.0.113.5' })).toBe(`email:${email}`);
  });

  it('cannot be made equal to an IP key by sending an address that looks like the IP', () => {
    const asEmail = passwordResetEmailKey({ body: { email: '203.0.113.5' }, ip: '198.51.100.7' });
    const asIp = passwordResetEmailKey({ body: {}, ip: '203.0.113.5' });

    expect(asEmail).not.toBe(asIp);
  });

  it('groups the addresses of an IPv6 subnet, so one client cannot get a budget per address', () => {
    expect(passwordResetEmailKey({ body: {}, ip: '2001:db8:abcd:12::1' })).toBe(
      passwordResetEmailKey({ body: {}, ip: '2001:db8:abcd:12::2' })
    );
  });
});
