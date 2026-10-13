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
