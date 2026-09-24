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

export function validateUpdateChatRoomBody(body: unknown): UpdateChatRoomValidation {
  // Express leaves req.body undefined when the request has no JSON body.
  const { name, avatar_url } = isRecord(body) ? body : {};

  if (name === undefined && avatar_url === undefined) {
    return { valid: false, message: "At least either Name or Avatar must be provided" };
  }

  const data: { name?: string; avatarUrl?: string | null } = {};

  if (name !== undefined) {
    if (typeof name !== 'string' || name.trim().length === 0) {
      return { valid: false, message: "'name' must be a non-empty string" };
    }
    if (name.trim().length > 100) {
      return { valid: false, message: "'name' must be 100 characters or fewer" };
    }
    data.name = name.trim();
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

// Largest value of a Postgres INTEGER column (User.id, ChatRoom.id). Anything
// above it can't be a real ID and would make the query itself fail (500)
// instead of being rejected as a bad request.
const MAX_ID = 2_147_483_647;

type AddMembersValidation =
  | { valid: true; data: { memberIds: number[] } }
  | { valid: false; message: string };

/**
 * Validates the body of POST /chatrooms/:chatid/members. Unlike room
 * creation, member_ids is required here (adding nobody is a client bug, not
 * a no-op). Returns the IDs deduplicated and camelCased for the service.
 */
export function validateAddMembersBody(body: unknown): AddMembersValidation {
  const { member_ids } = isRecord(body) ? body : {};

  if (
    !Array.isArray(member_ids) ||
    member_ids.length === 0 ||
    member_ids.some((id) => !Number.isInteger(id) || id < 1 || id > MAX_ID)
  ) {
    return { valid: false, message: "'member_ids' must be a non-empty array of user IDs" };
  }

  return { valid: true, data: { memberIds: Array.from(new Set(member_ids as number[])) } };
}

/**
 * Turns a numeric URL param into an ID, or null if it isn't one. Only plain
 * digit strings between 1 and MAX_ID are accepted, so forms Number() would
 * happily coerce - '1e3', ' 5 ', '0x10', '' - are rejected instead of
 * silently pointing at some other row.
 */
function parseIdParam(raw: unknown): number | null {
  const id = typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : NaN;

  return Number.isInteger(id) && id >= 1 && id <= MAX_ID ? id : null;
}

type ChatIdParamValidation =
  | { valid: true; data: { chatId: number } }
  | { valid: false; message: string };

/** Validates the ':chatid' URL param of every /chatrooms/:chatid route. */
export function validateChatIdParam(rawChatId: unknown): ChatIdParamValidation {
  const chatId = parseIdParam(rawChatId);

  return chatId === null
    ? { valid: false, message: 'Invalid chat room id' }
    : { valid: true, data: { chatId } };
}

type UserIdParamValidation =
  | { valid: true; data: { userId: number } }
  | { valid: false; message: string };

/** Validates the ':userid' URL param of /chatrooms/:chatid/members/:userid. */
export function validateUserIdParam(rawUserId: unknown): UserIdParamValidation {
  const userId = parseIdParam(rawUserId);

  return userId === null
    ? { valid: false, message: 'Invalid user id' }
    : { valid: true, data: { userId } };
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