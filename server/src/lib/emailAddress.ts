import validator from 'validator';

// How the app treats an email address. Signup, login and password reset all go through this file, so
// they cannot disagree about whether "John@x.com" and "john@x.com" are the same account.

export const INVALID_EMAIL = 'Invalid email format';

/**
 * `null` when `email` is a valid address, otherwise the message for the 400. It is the same check for
 * every address, so a 400 says nothing about who has an account. validator.isEmail looks at the format
 * only and accepts every casing: this says nothing about how the address is spelled, normalizeEmail does.
 */
export function validateEmail(email: string): string | null {
  return validator.isEmail(email) ? null : INVALID_EMAIL;
}

/**
 * The one spelling of an address that is stored, looked up and compared: lower-cased. Mail providers
 * deliver "John@x.com" and "john@x.com" to the same inbox and people retype their address in whatever
 * case their keyboard produced, so the app treats them as one account, like it does for phone numbers
 * (see normalizeTel in signup.validator.ts).
 *
 * Validators and controllers call this on the address from the request, before it reaches a service,
 * and the services take it as given. The database refuses any other spelling (the CHECK constraint
 * users_email_lowercase_check), so a caller that forgets fails on write instead of storing a second spelling.
 *
 * Only the case changes. validator.normalizeEmail is not used on purpose: it also removes dots and
 * "+tags" for some providers ("J.o.h.n+x@gmail.com" becomes "john@gmail.com"), which rewrites the
 * address people typed.
 */
export function normalizeEmail(email: string): string {
  return email.toLowerCase();
}
