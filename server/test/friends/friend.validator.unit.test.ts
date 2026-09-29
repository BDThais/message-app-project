import { describe, expect, it } from 'vitest';
import { validateTelParam } from '../../src/modules/friends/friend.validator';

// Pure function, so no database and no HTTP: the endpoint test only needs one
// bad-input case to prove the validator is wired in, and every other bad input
// lives here as one line in a table.

describe('validateTelParam', () => {
  it.each([
    ['a Vietnamese number', '+84912345678'],
    ['a US number', '+14155552671'],
  ])('accepts %s', (_label, tel) => {
    expect(validateTelParam(tel)).toEqual({ valid: true, data: { tel } });
  });

  // '+1 415 555 2671', '+1 (415) 555-2671', '+14155552671x123', trailing spaces
  // and non-ASCII digits all pass isValidPhoneNumber (the rule signup uses) but
  // are not canonical E.164, so they are rejected here on purpose.
  it.each([
    ['a number without the leading +', '84912345678'],
    ['a national number with no country code', '4155552671'],
    ['spaces inside the number', '+1 415 555 2671'],
    ['parentheses and dashes', '+1 (415) 555-2671'],
    ['an extension', '+14155552671x123'],
    ['non-ASCII digits', '+٨٤٩١٢٣٤٥٦٧٨'],
    ['a full-width plus sign', '＋14155552671'],
    ['leading whitespace', ' +14155552671'],
    ['trailing whitespace', '+14155552671 '],
    ['a trailing newline', '+14155552671\n'],
    ['a number too short for its country', '+1415555267'],
    ['a country code starting with 0', '+0123456789'],
    ['more than 15 digits', '+1234567890123456'],
    ['a letter in the number', '+1415555267a'],
    ['no digits at all', 'abc'],
    ['only a plus sign', '+'],
    ['an empty string', ''],
  ])('rejects %s', (_label, tel) => {
    expect(validateTelParam(tel)).toEqual({
      valid: false,
      message: "'tel' must be a valid phone number in E.164 format, for example +84912345678",
    });
  });

  it('rejects a value that is not a string', () => {
    expect(validateTelParam(undefined)).toMatchObject({ valid: false });
    expect(validateTelParam(14155552671)).toMatchObject({ valid: false });
  });
});
