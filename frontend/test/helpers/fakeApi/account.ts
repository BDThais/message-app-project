import type { LogoutResponse, MeResponse, MessageResponse, UserResponse } from '@contract/responses';
import { json, noContent } from './responses';
import type { Body, FakeServer } from './state';

// Like the server (see the signup section of api.doc.md): an address is stored lower-cased and
// matched without regard to case, at signup and at login.
const canonicalEmail = (email: string) => email.toLowerCase();

// The server checks a new password before it looks at the token, so a weak one does not use up the link.
const passwordProblem = (password: string): string | null =>
  /[A-Z]/.test(password) ? null : 'Password must contain at least one uppercase letter';

/** The account endpoints. Returns `undefined` for a request that is not one of them. */
export function accountEndpoints(request: string, body: Body, state: FakeServer): Response | undefined {
  const { accounts } = state;

  switch (request) {
    case 'GET /api/account/me':
      return json({ user: state.session } satisfies MeResponse);

    case 'POST /api/account/login': {
      const account = accounts.find(({ user }) => user.email === canonicalEmail(String(body?.email)));
      if (!account || account.password !== body?.password) return json({ error: 'Invalid email or password' }, 401);
      state.session = account.user;
      return json({ user: account.user } satisfies UserResponse);
    }

    case 'POST /api/account/logout':
      if (state.logoutFails) return json({ error: 'Something went wrong' }, 500);
      state.session = null;
      return json({ user: null } satisfies LogoutResponse);

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
      return json({ message: 'Account created successfully' } satisfies MessageResponse, 201);
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
      return json({ message: 'If an account exists for that email, a reset link is on its way' } satisfies MessageResponse, 202);

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

    // A stand-in for the endpoints that answer 401 for a wrong current password while the session is
    // still fine (this one and DELETE /api/account/me).
    case 'POST /api/account/password':
      return json({ error: 'Current password is wrong' }, 401);

    default:
      return undefined;
  }
}
