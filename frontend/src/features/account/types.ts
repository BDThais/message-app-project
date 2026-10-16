/** The signed-in user, as returned by POST /account/login, GET /account/me and PATCH /account/me. */
export interface User {
  id: number;
  name: string;
  email: string;
  tel: string;
  avatarUrl: string | null;
  emailVerified: boolean;
}

export interface LoginInput {
  email: string;
  password: string;
}

/** The body of POST /account/signup. There is no avatar here: a new account starts without one. */
export interface SignupInput {
  name: string;
  email: string;
  tel: string;
  password: string;
}

/** What POST /account/password/reset needs: the token from the mailed link and the new password. */
export interface ResetPasswordInput {
  token: string;
  newPassword: string;
}
