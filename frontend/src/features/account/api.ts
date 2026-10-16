import { api } from '../../lib/http';
import type { LoginInput, ResetPasswordInput, SignupInput, User } from './types';

// One function per endpoint; no React and no caching in here (see queries.ts for that).

/** `null` when nobody is signed in: GET /account/me answers 200 with `user: null` instead of a 401. */
export async function getMe(signal?: AbortSignal): Promise<User | null> {
  const { user } = await api.get<{ user: User | null }>('/account/me', { signal });
  return user;
}

export async function login(input: LoginInput): Promise<User> {
  const { user } = await api.post<{ user: User }>('/account/login', input);
  return user;
}

export async function logout(): Promise<void> {
  await api.post<{ user: null }>('/account/logout');
}

/** Creates the account. It does not sign anyone in: the person logs in afterwards. */
export async function signup(input: SignupInput): Promise<void> {
  await api.post<{ message: string }>('/account/signup', input);
}

/** The "resend" button: mails a new verification link to the signed-in user's address. */
export async function resendVerificationEmail(): Promise<void> {
  await api.post<void>('/account/email/verification');
}

/** Confirms an address with the token from a verification mail. Needs no session. */
export async function verifyEmail(token: string): Promise<void> {
  await api.post<void>('/account/email/verify', { token });
}

/** The server answers 202 for every well-formed address, so the caller learns nothing about who is registered. */
export async function requestPasswordReset(email: string): Promise<void> {
  await api.post<{ message: string }>('/account/password/reset-request', { email });
}

/** Sets a new password with the token from a reset mail. It does not sign anyone in. */
export async function resetPassword({ token, newPassword }: ResetPasswordInput): Promise<void> {
  await api.post<void>('/account/password/reset', { token, new_password: newPassword });
}
