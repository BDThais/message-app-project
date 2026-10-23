import { bodyFields } from '../../lib/validation';
import type { DeleteAccountBody } from '../../contract/requests';

type DeleteAccountValidation =
  | { valid: true; data: { password: string } }
  | { valid: false; message: string };

/**
 * Validates the body of DELETE /api/account/me: { password }. The password is only
 * checked to be a non-empty string here, because whether it is right is for
 * the controller to find out (a wrong one is a 401, not a 400).
 */
export function validateDeleteAccountBody(body: unknown): DeleteAccountValidation {
  const { password } = bodyFields<DeleteAccountBody>(body);

  if (typeof password !== 'string' || password === '') {
    return { valid: false, message: 'Password is required' };
  }

  return { valid: true, data: { password } };
}
