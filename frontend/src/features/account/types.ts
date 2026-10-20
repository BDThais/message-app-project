import type { LoginBody, SignupBody } from '@contract/requests';

/** The signed-in user, as returned by POST /api/account/login, GET /api/account/me and PATCH /api/account/me. */
export type { User } from '@contract/types';

export type LoginInput = LoginBody;

/** The body of POST /api/account/signup. There is no avatar here: a new account starts without one. */
export type SignupInput = SignupBody;

/**
 * What POST /api/account/password/reset needs: the token from the mailed link and the new password.
 * Not the wire body: `api.ts` renames `newPassword` to the `new_password` the server reads.
 */
export interface ResetPasswordInput {
  token: string;
  newPassword: string;
}
