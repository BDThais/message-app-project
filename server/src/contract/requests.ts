// Request bodies as they go over the wire: snake_case keys, as api.doc.md says. Every field is
// listed with the type a valid request has; what the server does with a request that does not
// match (which rule fails first, the error text) is in api.doc.md and in the validators.
//
// The account and chat room bodies are here; the friends module adds its own when its validators
// read their bodies through these types (see `bodyFields` in lib/validation.ts).

import type { Role, RoomType } from './types';

export interface SignupBody {
  name: string;
  email: string;
  tel: string;
  password: string;
}

export interface LoginBody {
  email: string;
  password: string;
}

/** At least one of the two. `avatar_url: null` clears the avatar. */
export interface UpdateProfileBody {
  name?: string;
  avatar_url?: string | null;
}

export interface ChangePasswordBody {
  current_password: string;
  new_password: string;
}

export interface DeleteAccountBody {
  password: string;
}

export interface VerifyEmailBody {
  token: string;
}

export interface PasswordResetRequestBody {
  email: string;
}

export interface ResetPasswordBody {
  token: string;
  new_password: string;
}

/**
 * `member_ids` is required for a direct room (exactly one id) and optional for a group room.
 * `name` and `avatar_url` are for group rooms only.
 */
export interface CreateChatRoomBody {
  type: RoomType;
  member_ids?: number[];
  name?: string;
  avatar_url?: string;
}

/** At least one of the two. `avatar_url: null` clears the avatar. */
export interface UpdateChatRoomBody {
  name?: string;
  avatar_url?: string | null;
}

export interface AddMembersBody {
  member_ids: number[];
}

export interface ChangeMemberRoleBody {
  role: Role;
}

export interface SendMessageBody {
  content: string;
}

/** An edit is held to the rules of a new message. */
export type EditMessageBody = SendMessageBody;

export interface MarkReadBody {
  message_id: number;
}

/** The query string of GET /api/chat/:chatid/message: a query's values are strings. */
export interface GetMessagesQuery {
  before?: string;
  limit?: string;
}
