// The JSON bodies of successful responses, named after what they carry. An endpoint that answers
// 204 has no body and no type here. Only the account endpoints are typed so far.

import type { User } from './types';

/** POST /api/account/signup (201) and POST /api/account/password/reset-request (202). */
export interface MessageResponse {
  message: string;
}

/** POST /api/account/login and PATCH /api/account/me. */
export interface UserResponse {
  user: User;
}

/** GET /api/account/me: `user` is null when nobody is signed in (still a 200). */
export interface MeResponse {
  user: User | null;
}

/** POST /api/account/logout. */
export interface LogoutResponse {
  user: null;
}
