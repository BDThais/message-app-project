import type { User } from '../../../src/features/account/types';

export const PASSWORD = 'Str0ng!Pass';
export const NEW_PASSWORD = 'An0ther!Pass';

export const john: User = {
  id: 1,
  name: 'JohnDoe',
  email: 'john@example.com',
  tel: '+1234567890',
  avatarUrl: null,
  emailVerified: false,
};

export interface Account {
  user: User;
  password: string;
}

/** The JSON body of a request, as the fake reads it (`undefined` when the request had none). */
export type Body = Record<string, string> | undefined;

/** One request the fake saw: `"POST /api/account/login"` and its parsed JSON body (`undefined` when it had none). */
export interface Call {
  request: string;
  body: unknown;
}

/**
 * The fake server's state, shared by the endpoint files of every feature (accounts today, rooms and
 * friends when their endpoints are faked). `signedIn` says whether the cookie in this browser
 * belongs to John.
 */
export function createState({ signedIn }: { signedIn: boolean }) {
  const accounts: Account[] = [{ user: { ...john }, password: PASSWORD }]; // a copy: tests change it

  return {
    accounts,
    /** Mailed tokens that have not been used yet: token -> id of the account the mail went to. */
    verificationTokens: new Map<string, number>(),
    resetTokens: new Map<string, number>(),
    sessionUserId: signedIn ? john.id : (null as number | null),
    /** Make POST /account/email/verification answer 429, as it does within a minute of the last mail. */
    resendLimited: false,
    /** While set, every request waits for it before it is answered (to look at a request that is still running). */
    gate: null as Promise<void> | null,
    requests: [] as string[],
    calls: [] as Call[],
    /** Who the cookie belongs to. Setting it signs that user in (or out, with `null`). */
    get session(): User | null {
      return accounts.find((account) => account.user.id === this.sessionUserId)?.user ?? null;
    },
    set session(user: User | null) {
      this.sessionUserId = user ? user.id : null;
    },
    count(request: string): number {
      return this.requests.filter((seen) => seen === request).length;
    },
  };
}

export type FakeServer = ReturnType<typeof createState>;
