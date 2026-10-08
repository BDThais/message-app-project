import { describe, expect, it } from 'vitest';
import { checkSessionSettings } from '../../src/modules/account/session.service';

describe('checkSessionSettings', () => {
  it.each([1, 3_600_000, 604_800_000, 365 * 24 * 60 * 60 * 1000])('accepts a lifetime of %d ms', (ttl) => {
    expect(() => checkSessionSettings({ SESSION_TTL_MS: ttl })).not.toThrow();
  });

  it.each([
    { desc: 'NaN (a mistyped value such as "7d")', ttl: Number.NaN },
    { desc: 'zero', ttl: 0 },
    { desc: 'a negative number', ttl: -1 },
    { desc: 'a fraction', ttl: 1.5 },
    { desc: 'Infinity', ttl: Number.POSITIVE_INFINITY },
    { desc: 'a lifetime so long that the expiry is not a date', ttl: 1e17 },
  ])('rejects $desc', ({ ttl }) => {
    expect(() => checkSessionSettings({ SESSION_TTL_MS: ttl })).toThrow(/SESSION_TTL_MS must be a whole number/);
  });
});
