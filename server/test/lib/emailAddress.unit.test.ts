import { describe, expect, it } from 'vitest';
import { INVALID_EMAIL, normalizeEmail, validateEmail } from '../../src/lib/emailAddress';

// No database. The rules that make an address one account whatever its case are tested where they
// are used: signup.test.ts (stored lower-cased, a second spelling is taken, login with any spelling),
// passwordResetRequest.test.ts (reset request) and user.schema.test.ts (the CHECK constraint).

describe('validateEmail', () => {
  // validator.isEmail checks the format only. It has no opinion on case, so a valid address is valid
  // in every case, and normalizeEmail is what makes the spellings one address.
  it.each([
    ['lower case', 'john.doe@example.com'],
    ['mixed case', 'John.Doe@Example.com'],
    ['upper case', 'JOHN.DOE@EXAMPLE.COM'],
    ['a plus tag', 'john+news@example.com'],
  ])('accepts a valid address in %s', (_label, email) => {
    expect(validateEmail(email)).toBeNull();
  });

  it.each([
    ['no @', 'john.example.com'],
    ['no domain', 'john@'],
    ['no local part', '@example.com'],
    ['spaces around a valid address', ' john@example.com '],
    ['an empty string', ''],
  ])('refuses %s with the 400 message', (_label, email) => {
    expect(validateEmail(email)).toBe(INVALID_EMAIL);
    expect(INVALID_EMAIL).toBe('Invalid email format');
  });
});

describe('normalizeEmail', () => {
  it.each([
    ['John.Doe@Example.com', 'john.doe@example.com'],
    ['JOHN.DOE@EXAMPLE.COM', 'john.doe@example.com'],
    ['john.doe@example.com', 'john.doe@example.com'],
  ])('writes %s as %s', (email, canonical) => {
    expect(normalizeEmail(email)).toBe(canonical);
  });

  it('changes the case and nothing else: no trimming, and dots and +tags stay (validator.normalizeEmail would remove them for some providers)', () => {
    expect(normalizeEmail('J.o.h.n+News@Gmail.com')).toBe('j.o.h.n+news@gmail.com');
    expect(normalizeEmail(' John@Example.com ')).toBe(' john@example.com ');
  });

  it('is idempotent', () => {
    const once = normalizeEmail('John.Doe@Example.COM');

    expect(normalizeEmail(once)).toBe(once);
  });
});
