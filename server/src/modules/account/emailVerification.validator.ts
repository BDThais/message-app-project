import { isRecord } from '../../lib/validation';

type VerifyEmailValidation =
  | { valid: true; data: { token: string } }
  | { valid: false; message: string };

/**
 * Validates the body of POST /account/email/verify: { token }. The token is
 * only checked to be a non-empty string here; whether it is a real, unused,
 * unexpired one is for the service to find out (that is a 400 with its own
 * message, the same for every way a link can be dead).
 */
export function validateVerifyEmailBody(body: unknown): VerifyEmailValidation {
  // Express leaves req.body undefined when the request has no JSON body.
  const { token } = isRecord(body) ? body : {};

  if (typeof token !== 'string' || token === '') {
    return { valid: false, message: 'Token is required' };
  }

  return { valid: true, data: { token } };
}
