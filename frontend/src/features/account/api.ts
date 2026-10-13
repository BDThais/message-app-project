import { api } from '../../lib/http';
import type { LoginInput, User } from './types';

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
