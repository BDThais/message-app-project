import { vi } from 'vitest';
import type { User } from '../features/account/types';

// A fake of the server's account endpoints, as a stubbed `fetch`, for the app-level tests. It
// follows api.doc.md (status codes, error texts, the snake_case request bodies) but not the
// server's code: it only has to be faithful enough for the screens to be exercised through the real
// router, guards and query client.

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

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function noContent(): Response {
  return new Response(null, { status: 204 });
}

interface Account {
  user: User;
  password: string;
}

// Like the server (see the signup section of api.doc.md): an address is stored lower-cased and
// matched without regard to case, at signup and at login.
const canonicalEmail = (email: string) => email.toLowerCase();

/** One request the fake saw: `"POST /api/account/login"` and its parsed JSON body (`undefined` when it had none). */
export interface Call {
  request: string;
  body: unknown;
}

/**
 * Starts the fake server. `signedIn` says whether the cookie in this browser belongs to John.
 * The returned object is the server's state, for tests to look at and to change.
 */
export function stubApi({ signedIn = false }: { signedIn?: boolean } = {}) {
  const accounts: Account[] = [{ user: { ...john }, password: PASSWORD }]; // a copy: tests change it

  const state = {
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

  // The server checks a new password before it looks at the token, so a weak one does not use up the link.
  const passwordProblem = (password: string): string | null =>
    /[A-Z]/.test(password) ? null : 'Password must contain at least one uppercase letter';

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const request = `${init?.method ?? 'GET'} ${url}`;
      const body = init?.body === undefined ? undefined : (JSON.parse(String(init.body)) as Record<string, string>);
      state.requests.push(request);
      state.calls.push({ request, body });
      await state.gate;

      switch (request) {
        case 'GET /api/account/me':
          return json({ user: state.session });

        case 'POST /api/account/login': {
          const account = accounts.find(({ user }) => user.email === canonicalEmail(String(body?.email)));
          if (!account || account.password !== body?.password) return json({ error: 'Invalid email or password' }, 401);
          state.session = account.user;
          return json({ user: account.user });
        }

        case 'POST /api/account/logout':
          state.session = null;
          return json({ user: null });

        case 'POST /api/account/signup': {
          if (!body?.name || !body.email || !body.tel || !body.password) return json({ error: 'All fields are required' }, 400);
          const problem = passwordProblem(body.password);
          if (problem) return json({ error: problem }, 400);
          const email = canonicalEmail(body.email);
          if (accounts.some(({ user }) => user.email === email)) return json({ error: 'Email already exists' }, 409);
          const id = Math.max(...accounts.map(({ user }) => user.id)) + 1;
          accounts.push({
            user: { id, name: body.name, email, tel: body.tel, avatarUrl: null, emailVerified: false },
            password: body.password,
          });
          return json({ message: 'Account created successfully' }, 201);
        }

        case 'POST /api/account/email/verification': {
          const user = state.session;
          if (!user) return json({ error: 'Unauthorized Access' }, 401);
          if (user.emailVerified) return json({ error: 'Email is already verified' }, 409);
          if (state.resendLimited) return json({ error: 'Please wait a minute before asking for another email' }, 429);
          return noContent();
        }

        case 'POST /api/account/email/verify': {
          const id = state.verificationTokens.get(String(body?.token));
          const account = accounts.find(({ user }) => user.id === id);
          if (!account) return json({ error: 'This verification link is invalid or has expired' }, 400);
          state.verificationTokens.delete(String(body?.token)); // a link works once
          account.user.emailVerified = true;
          return noContent();
        }

        case 'POST /api/account/password/reset-request':
          // The same answer for every address, registered or not.
          return json({ message: 'If an account exists for that email, a reset link is on its way' }, 202);

        case 'POST /api/account/password/reset': {
          const problem = passwordProblem(String(body?.new_password));
          if (problem) return json({ error: problem }, 400);
          const id = state.resetTokens.get(String(body?.token));
          const account = accounts.find(({ user }) => user.id === id);
          if (!account) return json({ error: 'This reset link is invalid or has expired' }, 400);
          state.resetTokens.delete(String(body?.token));
          account.password = String(body?.new_password);
          if (state.sessionUserId === account.user.id) state.sessionUserId = null; // every session of the account goes
          return noContent();
        }

        // Stand-ins for any protected endpoint: 401 when there is no session. The password one also
        // answers 401 for a wrong current password, with the session still fine.
        case 'GET /api/chat':
          return state.session ? json({ chatRooms: [] }) : json({ error: 'Unauthorized Access' }, 401);
        case 'POST /api/account/password':
          return json({ error: 'Current password is wrong' }, 401);

        default:
          return json({ error: `not stubbed: ${request}` }, 500);
      }
    }),
  );

  return state;
}

export type FakeServer = ReturnType<typeof stubApi>;
