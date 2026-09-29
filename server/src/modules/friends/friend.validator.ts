import { isValidPhoneNumber } from 'libphonenumber-js';

// A full E.164 number in its canonical spelling: '+', a country code that
// does not start with 0, and at most 15 digits in total.
const E164_RE = /^\+[1-9]\d{1,14}$/;

type TelParamValidation =
  | { valid: true; data: { tel: string } }
  | { valid: false; message: string };

/**
 * Validates the ':tel' URL param of GET /friend/search/:tel.
 *
 * Two checks, both required:
 * - isValidPhoneNumber with no default country, the same call signup makes
 *   (signup.validator.ts), so the number must carry its country code and be
 *   a real number for that country;
 * - the canonical E.164 spelling. isValidPhoneNumber alone also accepts
 *   '+1 415 555 2671', '+1 (415) 555-2671', '+14155552671 ext. 123' and
 *   non-ASCII digits. The lookup is an exact string match, so accepting
 *   those spellings would answer "nobody found" for a number that is
 *   registered, which is worse than a 400 that says what format to send.
 */
export function validateTelParam(rawTel: unknown): TelParamValidation {
  if (typeof rawTel !== 'string' || !E164_RE.test(rawTel) || !isValidPhoneNumber(rawTel)) {
    return {
      valid: false,
      message: "'tel' must be a valid phone number in E.164 format, for example +84912345678",
    };
  }

  return { valid: true, data: { tel: rawTel } };
}
