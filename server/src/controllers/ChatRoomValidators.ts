type ValidRoomType = 'direct' | 'group';

type CreateChatRoomBody = Partial<{
  type: ValidRoomType;
  member_ids: number[];
  name: string;
  avatar_url: string;
}>;

type ValidationResult =
    | {
        valid: true;
        type: ValidRoomType;
        memberIds: number[];
        name?: string;
        avatarUrl?: string;
    }
    | { valid: false; error: string };

/**
 * Validates the body of POST /chatrooms and returns everything the
 * controller needs, normalized:
 * - memberIds: deduplicated, with the requester's own ID filtered out (the
 *   controller adds them back separately since their role differs by room
 *   type - always admin for direct, admin-as-creator for group).
 * - name / avatarUrl: only present when valid, camelCased to match the
 *   Prisma field names.
 */
export function validateCreateChatRoomInput(
  body: CreateChatRoomBody,
  requesterId: number
): ValidationResult;
export function validateCreateChatRoomInput(
  body: unknown,
  requesterId: number
): ValidationResult;
export function validateCreateChatRoomInput(
  body: unknown,
  requesterId: number
): ValidationResult {
  const { type, member_ids, name, avatar_url } = isRecord(body) ? body : {};

    if (type !== 'direct' && type !== 'group') {
        return { valid: false, error: 'type must be "direct" or "group"' };
    }

    if (member_ids !== undefined && (
      !Array.isArray(member_ids) ||
      member_ids.some((id) => !Number.isInteger(id))
    )) {
      return { valid: false, error: 'member_ids must be an array of user IDs' };
    }

    const memberIds = Array.from(new Set((member_ids ?? []) as number[])).filter(
        (id) => id !== requesterId
    );

    if (type === 'direct') {
        if (memberIds.length !== 1) {
            return { valid: false, error: 'a direct chat room requires exactly one other member' };
        }
        if (name !== undefined || avatar_url !== undefined) {
            return { valid: false, error: 'direct chat rooms cannot have a name or avatar' };
        }
    }

    if (name !== undefined && (typeof name !== 'string' || name.trim().length === 0)) {
        return { valid: false, error: 'name must be a non-empty string if provided' };
    }

    if (avatar_url !== undefined && typeof avatar_url !== 'string') {
        return { valid: false, error: 'avatar_url must be a string if provided' };
    }

    return {
        valid: true,
        type,
        memberIds,
        ...(name !== undefined ? { name } : {}),
        ...(avatar_url !== undefined ? { avatarUrl: avatar_url } : {}),
    };
}


type UpdateChatRoomValidation =
  | { valid: true; data: { name?: string; avatarUrl?: string | null } }
  | { valid: false; message: string };

export function validateUpdateChatRoomBody(body: any): UpdateChatRoomValidation {
  if (body.name === undefined && body.avatar_url === undefined) {
    return { valid: false, message: "At least either Name or Avatar must be provided" };
  }

  const data: { name?: string; avatarUrl?: string | null } = {};

  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || body.name.trim().length === 0) {
      return { valid: false, message: "'name' must be a non-empty string" };
    }
    if (body.name.trim().length > 100) {
      return { valid: false, message: "'name' must be 100 characters or fewer" };
    }
    data.name = body.name.trim();
  }

  if (body.avatar_url !== undefined) {
    if (body.avatar_url !== null && typeof body.avatar_url !== 'string') {
      return { valid: false, message: "'avatar_url' must be a string or null" };
    }
    if (typeof body.avatar_url === 'string' && !isValidHttpUrl(body.avatar_url)) {
      return { valid: false, message: "'avatar_url' must be a valid URL" };
    }
    data.avatarUrl = body.avatar_url;
  }

  return { valid: true, data };
}

function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}