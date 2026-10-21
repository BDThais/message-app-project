import { MAX_INT32 as MAX_ID } from '../../lib/constants';
import { parseIdParam } from '../../lib/parseIdParam';
import { bodyFields, isValidHttpUrl } from '../../lib/validation';
import type {
  AddMembersBody, ChangeMemberRoleBody, CreateChatRoomBody, GetMessagesQuery, MarkReadBody,
  SendMessageBody, UpdateChatRoomBody
} from '../../contract/requests';
import type { RoomType } from '../../contract/types';

// Longest group name, counted after trimming: the same limit when a room is created and when it is renamed.
const MAX_CHAT_NAME_LENGTH = 100;

type ValidationResult =
    | {
        valid: true;
        type: RoomType;
        memberIds: number[];
        name?: string;
        avatarUrl?: string;
    }
    | { valid: false; message: string };

/**
 * Returns everything the controller needs, normalized: `memberIds` deduplicated and without the
 * requester's own ID (the service adds them back, with a role that depends on the room type), `name`
 * and `avatarUrl` only when valid, camelCased to match the Prisma field names.
 */
export function validateCreateChatRoomInput(
  body: unknown,
  requesterId: number
): ValidationResult {
  const { type, member_ids, name, avatar_url } = bodyFields<CreateChatRoomBody>(body);

    if (type !== 'direct' && type !== 'group') {
        return { valid: false, message: 'type must be "direct" or "group"' };
    }

    // Same ID range as validateAddMembersBody. An ID outside the INTEGER column's range would make the
    // friendship lookup fail with a 500.
    if (member_ids !== undefined && (
      !Array.isArray(member_ids) ||
      member_ids.some((id) => !Number.isInteger(id) || id < 1 || id > MAX_ID)
    )) {
      return { valid: false, message: 'member_ids must be an array of user IDs' };
    }

    const memberIds = Array.from(new Set((member_ids ?? []) as number[])).filter(
        (id) => id !== requesterId
    );

    if (type === 'direct') {
        if (memberIds.length !== 1) {
            return { valid: false, message: 'a direct chat room requires exactly one other member' };
        }
        if (name !== undefined || avatar_url !== undefined) {
            return { valid: false, message: 'direct chat rooms cannot have a name or avatar' };
        }
    }

    if (name !== undefined && (typeof name !== 'string' || name.trim().length === 0)) {
        return { valid: false, message: 'name must be a non-empty string if provided' };
    }

    if (name !== undefined && name.trim().length > MAX_CHAT_NAME_LENGTH) {
        return { valid: false, message: `name must be ${MAX_CHAT_NAME_LENGTH} characters or fewer` };
    }

    if (avatar_url !== undefined && typeof avatar_url !== 'string') {
        return { valid: false, message: 'avatar_url must be a string if provided' };
    }

    if (avatar_url !== undefined && !isValidHttpUrl(avatar_url)) {
        return { valid: false, message: 'avatar_url must be a valid URL' };
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
  const { name, avatar_url } = bodyFields<UpdateChatRoomBody>(body);

  if (name === undefined && avatar_url === undefined) {
    return { valid: false, message: "At least either Name or Avatar must be provided" };
  }

  const data: { name?: string; avatarUrl?: string | null } = {};

  if (name !== undefined) {
    if (typeof name !== 'string' || name.trim().length === 0) {
      return { valid: false, message: "'name' must be a non-empty string" };
    }
    if (name.trim().length > MAX_CHAT_NAME_LENGTH) {
      return { valid: false, message: `'name' must be ${MAX_CHAT_NAME_LENGTH} characters or fewer` };
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

type AddMembersValidation =
  | { valid: true; data: { memberIds: number[] } }
  | { valid: false; message: string };

/** member_ids is required here, unlike at room creation: adding nobody is a client bug, not a no-op. */
export function validateAddMembersBody(body: unknown): AddMembersValidation {
  const { member_ids } = bodyFields<AddMembersBody>(body);

  if (
    !Array.isArray(member_ids) ||
    member_ids.length === 0 ||
    member_ids.some((id) => !Number.isInteger(id) || id < 1 || id > MAX_ID)
  ) {
    return { valid: false, message: "'member_ids' must be a non-empty array of user IDs" };
  }

  return { valid: true, data: { memberIds: Array.from(new Set(member_ids as number[])) } };
}

type ChangeMemberRoleValidation =
  | { valid: true; data: { role: 'admin' | 'member' } }
  | { valid: false; message: string };

export function validateChangeMemberRoleBody(body: unknown): ChangeMemberRoleValidation {
  const { role } = bodyFields<ChangeMemberRoleBody>(body);

  if (role !== 'admin' && role !== 'member') {
    return { valid: false, message: "'role' must be 'admin' or 'member'" };
  }

  return { valid: true, data: { role } };
}

type SendMessageValidation =
  | { valid: true; data: { content: string } }
  | { valid: false; message: string };

const MAX_MESSAGE_LENGTH = 4000;

export function validateSendMessageBody(body: unknown): SendMessageValidation {
  const { content } = bodyFields<SendMessageBody>(body);

  if (typeof content !== 'string' || content.trim().length === 0) {
    return { valid: false, message: "'content' must be a non-empty string" };
  }

  if (content.trim().length > MAX_MESSAGE_LENGTH) {
    return {
      valid: false,
      message: `'content' must be ${MAX_MESSAGE_LENGTH} characters or fewer`,
    };
  }

  return { valid: true, data: { content: content.trim() } };
}

type MarkReadValidation =
  | { valid: true; data: { messageId: number } }
  | { valid: false; message: string };

export function validateMarkReadBody(body: unknown): MarkReadValidation {
  const { message_id } = bodyFields<MarkReadBody>(body);

  if (!Number.isInteger(message_id) || (message_id as number) < 1 || (message_id as number) > MAX_ID) {
    return { valid: false, message: "'message_id' must be a positive integer message id" };
  }

  return { valid: true, data: { messageId: message_id as number } };
}

type EditMessageValidation = SendMessageValidation;

/**
 * An edit is held to exactly the rules of a new message: a message can't be edited into something it
 * couldn't have been sent as. Its own function so the two can diverge without touching the send route.
 */
export function validateEditMessageBody(body: unknown): EditMessageValidation {
  return validateSendMessageBody(body);
}

type GetMessagesQueryValidation =
  | { valid: true; data: { limit: number; before?: number } }
  | { valid: false; message: string };

const DEFAULT_MESSAGE_PAGE_SIZE = 50;
const MAX_MESSAGE_PAGE_SIZE = 100;

export function validateGetMessagesQuery(query: unknown): GetMessagesQueryValidation {
  const { before, limit } = bodyFields<GetMessagesQuery>(query);

  let parsedBefore: number | undefined;
  if (before !== undefined) {
    const beforeId = parseIdParam(before);
    if (beforeId === null) {
      return { valid: false, message: "'before' must be a positive integer message id" };
    }
    parsedBefore = beforeId;
  }

  let parsedLimit = DEFAULT_MESSAGE_PAGE_SIZE;
  if (limit !== undefined) {
    const rawLimit = typeof limit === 'string' && /^\d+$/.test(limit) ? Number(limit) : NaN;
    if (!Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > MAX_MESSAGE_PAGE_SIZE) {
      return {
        valid: false,
        message: `'limit' must be an integer between 1 and ${MAX_MESSAGE_PAGE_SIZE}`,
      };
    }
    parsedLimit = rawLimit;
  }

  return {
    valid: true,
    data: { limit: parsedLimit, ...(parsedBefore !== undefined ? { before: parsedBefore } : {}) },
  };
}

type ChatIdParamValidation =
  | { valid: true; data: { chatId: number } }
  | { valid: false; message: string };

export function validateChatIdParam(rawChatId: unknown): ChatIdParamValidation {
  const chatId = parseIdParam(rawChatId);

  return chatId === null
    ? { valid: false, message: 'Invalid chat room id' }
    : { valid: true, data: { chatId } };
}

type UserIdParamValidation =
  | { valid: true; data: { userId: number } }
  | { valid: false; message: string };

export function validateUserIdParam(rawUserId: unknown): UserIdParamValidation {
  const userId = parseIdParam(rawUserId);

  return userId === null
    ? { valid: false, message: 'Invalid user id' }
    : { valid: true, data: { userId } };
}

type MessageIdParamValidation =
  | { valid: true; data: { messageId: number } }
  | { valid: false; message: string };

export function validateMessageIdParam(rawMessageId: unknown): MessageIdParamValidation {
  const messageId = parseIdParam(rawMessageId);

  return messageId === null
    ? { valid: false, message: 'Invalid message id' }
    : { valid: true, data: { messageId } };
}
