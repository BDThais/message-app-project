import { isRecord } from '../../lib/validation';

type DeleteAccountValidation =
  | { valid: true; data: { password: string } }
  | { valid: false; message: string };

/**
 * Validates the body of DELETE /account/me: { password }. The password is only
 * checked to be a non-empty string here, because whether it is right is for
 * the controller to find out (a wrong one is a 401, not a 400).
 */
export function validateDeleteAccountBody(body: unknown): DeleteAccountValidation {
  // Express leaves req.body undefined when the request has no JSON body.
  const { password } = isRecord(body) ? body : {};

  if (typeof password !== 'string' || password === '') {
    return { valid: false, message: 'Password is required' };
  }

  return { valid: true, data: { password } };
}
