import { bodyFields } from '../../lib/validation';
import type { VerifyEmailBody } from '../../contract/requests';

type VerifyEmailValidation =
  | { valid: true; data: { token: string } }
  | { valid: false; message: string };

/**
 * Validates the body of POST /api/account/email/verify: { token }. The token is
 * only checked to be a non-empty string here; whether it is a real, unused,
 * unexpired one is for the service to find out (that is a 400 with its own
 * message, the same for every way a link can be dead).
 */
export function validateVerifyEmailBody(body: unknown): VerifyEmailValidation {
  const { token } = bodyFields<VerifyEmailBody>(body);

  if (typeof token !== 'string' || token === '') {
    return { valid: false, message: 'Token is required' };
  }

  return { valid: true, data: { token } };
}
