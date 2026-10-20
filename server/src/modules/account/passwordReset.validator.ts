import { normalizeEmail, validateEmail } from '../../lib/emailAddress';
import { bodyFields } from '../../lib/validation';
import type { PasswordResetRequestBody, ResetPasswordBody } from '../../contract/requests';
import { validatePassword } from './signup.validator';

type ResetRequestValidation =
  | { valid: true; data: { email: string } }
  | { valid: false; message: string };

/**
 * Validates the body of POST /api/account/password/reset-request: { email }, a
 * valid address (validateEmail, the check signup uses). It is the same check
 * for every address, registered or not, so a 400 says nothing about who has an
 * account. The address that comes out is lower-cased (normalizeEmail), as
 * stored and as login looks it up; it is not trimmed.
 */
export function validatePasswordResetRequestBody(body: unknown): ResetRequestValidation {
  // Express leaves req.body undefined when the request has no JSON body.
  const { email } = bodyFields<PasswordResetRequestBody>(body);

  if (typeof email !== 'string' || email === '') {
    return { valid: false, message: 'Email is required' };
  }
  const emailError = validateEmail(email);
  if (emailError) {
    return { valid: false, message: emailError };
  }

  return { valid: true, data: { email: normalizeEmail(email) } };
}

type ResetPasswordValidation =
  | { valid: true; data: { token: string; newPassword: string } }
  | { valid: false; message: string };

/**
 * Validates the body of POST /api/account/password/reset: { token, new_password }.
 * `new_password` follows the signup password rules and is checked here, before
 * the token is looked at, so a weak password is a 400 that does not use up the
 * link. The token is only checked to be a non-empty string; whether it is a
 * real, unused, unexpired one is for the service to find out (a 400 with its
 * own message, the same for every way a link can be dead).
 */
export function validateResetPasswordBody(body: unknown): ResetPasswordValidation {
  const { token, new_password } = bodyFields<ResetPasswordBody>(body);

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
