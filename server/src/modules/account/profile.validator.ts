import { isRecord, isValidHttpUrl } from '../../lib/validation';
import { validateName } from './signup.validator';

type UpdateProfileValidation =
  | { valid: true; data: { name?: string; avatarUrl?: string | null } }
  | { valid: false; message: string };

/**
 * Validates the body of PATCH /account/me: { name?, avatar_url? } with at
 * least one of them. `name` follows signup's rule; `avatar_url` follows the
 * one on PATCH /chat/:chatid (an http(s) URL, or null to clear it). Returns
 * only the fields that were sent, camelCased to match the Prisma field names.
 */
export function validateUpdateProfileBody(body: unknown): UpdateProfileValidation {
  // Express leaves req.body undefined when the request has no JSON body.
  const { name, avatar_url } = isRecord(body) ? body : {};

  if (name === undefined && avatar_url === undefined) {
    return { valid: false, message: "At least either 'name' or 'avatar_url' must be provided" };
  }

  const data: { name?: string; avatarUrl?: string | null } = {};

  if (name !== undefined) {
    if (typeof name !== 'string' || name === '') {
      return { valid: false, message: "'name' must be a non-empty string" };
    }
    const nameError = validateName(name);
    if (nameError) {
      return { valid: false, message: nameError };
    }
    data.name = name;
  }

  if (avatar_url !== undefined) {
    if (avatar_url === null) {
      data.avatarUrl = null;
    } else if (typeof avatar_url !== 'string') {
      return { valid: false, message: "'avatar_url' must be a string or null" };
    } else if (!isValidHttpUrl(avatar_url)) {
      return { valid: false, message: "'avatar_url' must be a valid URL" };
    } else {
      data.avatarUrl = avatar_url;
    }
  }

  return { valid: true, data };
}
