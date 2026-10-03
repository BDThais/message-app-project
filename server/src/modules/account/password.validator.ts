import { isRecord } from '../../lib/validation';
import { validatePassword } from './signup.validator';

type ChangePasswordValidation =
  | { valid: true; data: { currentPassword: string; newPassword: string } }
  | { valid: false; message: string };

/**
 * Validates the body of POST /account/password: { current_password,
 * new_password }. `new_password` follows the signup password rules;
 * `current_password` is only checked to be a non-empty string here, because
 * whether it is right is for the controller to find out (a wrong one is a 401,
 * not a 400).
 */
export function validateChangePasswordBody(body: unknown): ChangePasswordValidation {
  // Express leaves req.body undefined when the request has no JSON body.
  const { current_password, new_password } = isRecord(body) ? body : {};

  if (
    typeof current_password !== 'string' || current_password === '' ||
    typeof new_password !== 'string' || new_password === ''
  ) {
    return { valid: false, message: 'Current password and new password are required' };
  }

  const passwordError = validatePassword(new_password);
  if (passwordError) {
    return { valid: false, message: passwordError };
  }

  return { valid: true, data: { currentPassword: current_password, newPassword: new_password } };
}
