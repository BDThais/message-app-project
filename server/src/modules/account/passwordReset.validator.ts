import validator from 'validator';
import { isRecord } from '../../lib/validation';
import { validatePassword } from './signup.validator';

type ResetRequestValidation =
  | { valid: true; data: { email: string } }
  | { valid: false; message: string };

/**
 * Validates the body of POST /account/password/reset-request: { email }, a
 * string accepted by validator.isEmail. It is the same check for every
 * address, registered or not, so a 400 says nothing about who has an account.
 * The address is used as it was sent (no trimming, no lower-casing): matching
 * is exact, like login.
 */
export function validatePasswordResetRequestBody(body: unknown): ResetRequestValidation {
  // Express leaves req.body undefined when the request has no JSON body.
  const { email } = isRecord(body) ? body : {};

  if (typeof email !== 'string' || email === '') {
    return { valid: false, message: 'Email is required' };
  }
  if (!validator.isEmail(email)) {
    return { valid: false, message: 'Invalid email format' };
  }

  return { valid: true, data: { email } };
}

type ResetPasswordValidation =
  | { valid: true; data: { token: string; newPassword: string } }
  | { valid: false; message: string };

/**
 * Validates the body of POST /account/password/reset: { token, new_password }.
 * `new_password` follows the signup password rules and is checked here, before
 * the token is looked at, so a weak password is a 400 that does not use up the
 * link. The token is only checked to be a non-empty string; whether it is a
 * real, unused, unexpired one is for the service to find out (a 400 with its
 * own message, the same for every way a link can be dead).
 */
export function validateResetPasswordBody(body: unknown): ResetPasswordValidation {
  const { token, new_password } = isRecord(body) ? body : {};

  if (
    typeof token !== 'string' || token === '' ||
    typeof new_password !== 'string' || new_password === ''
  ) {
    return { valid: false, message: 'Token and new password are required' };
  }

  const passwordError = validatePassword(new_password);
  if (passwordError) {
    return { valid: false, message: passwordError };
  }

  return { valid: true, data: { token, newPassword: new_password } };
}
