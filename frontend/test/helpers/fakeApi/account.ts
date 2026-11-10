import type { DeleteAccountConflictBody } from '@contract/errors';
import type { LogoutResponse, MeResponse, MessageResponse, UserResponse } from '@contract/responses';
import { json, noContent } from './responses';
import { textField } from './body';
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
      const account = accounts.find(({ user }) => user.email === canonicalEmail(textField(body, 'email')));
      if (!account || account.password !== textField(body, 'password'))
        return json({ error: 'Invalid email or password' }, 401);
      state.session = account.user;
      return json({ user: account.user } satisfies UserResponse);
    }

    case 'POST /api/account/logout':
      if (state.logoutFails) return json({ error: 'Something went wrong' }, 500);
      state.session = null;
      return json({ user: null } satisfies LogoutResponse);

    case 'POST /api/account/signup': {
      const [name, tel, password] = [textField(body, 'name'), textField(body, 'tel'), textField(body, 'password')];
      if (!name || !textField(body, 'email') || !tel || !password)
        return json({ error: 'All fields are required' }, 400);
      const problem = passwordProblem(password);
      if (problem) return json({ error: problem }, 400);
      const email = canonicalEmail(textField(body, 'email'));
      if (accounts.some(({ user }) => user.email === email)) return json({ error: 'Email already exists' }, 409);
      const id = Math.max(...accounts.map(({ user }) => user.id)) + 1;
      accounts.push({
        user: { id, name, email, tel, avatarUrl: null, emailVerified: false },
        password,
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
      const id = state.verificationTokens.get(textField(body, 'token'));
      const account = accounts.find(({ user }) => user.id === id);
      if (!account) return json({ error: 'This verification link is invalid or has expired' }, 400);
      state.verificationTokens.delete(textField(body, 'token')); // a link works once
      account.user.emailVerified = true;
      return noContent();
    }

    case 'POST /api/account/password/reset-request':
      // The same answer for every address, registered or not.
      return json(
        { message: 'If an account exists for that email, a reset link is on its way' } satisfies MessageResponse,
        202,
      );

    case 'POST /api/account/password/reset': {
      const problem = passwordProblem(textField(body, 'new_password'));
      if (problem) return json({ error: problem }, 400);
      const id = state.resetTokens.get(textField(body, 'token'));
      const account = accounts.find(({ user }) => user.id === id);
      if (!account) return json({ error: 'This reset link is invalid or has expired' }, 400);
      state.resetTokens.delete(textField(body, 'token'));
      account.password = textField(body, 'new_password');
      if (state.sessionUserId === account.user.id) state.sessionUserId = null; // every session of the account goes
      return noContent();
    }

    case 'PATCH /api/account/me': {
      const account = accounts.find(({ user }) => user.id === state.sessionUserId);
      if (!account) return json({ error: 'Unauthorized Access' }, 401);
      const sent = (field: string) => body !== undefined && body !== null && field in body;
      if (!sent('name') && !sent('avatar_url'))
        return json({ error: "At least either 'name' or 'avatar_url' must be provided" }, 400);
      if (sent('name')) {
        const name = textField(body, 'name');
        if (name === '') return json({ error: "'name' must be a non-empty string" }, 400);
        if (!/^[A-Za-z0-9]+$/.test(name)) return json({ error: 'Name must contain only letters and numbers' }, 400);
        account.user.name = name;
      }
      if (sent('avatar_url')) {
        const url = body?.avatar_url;
        if (url !== null && typeof url !== 'string')
          return json({ error: "'avatar_url' must be a string or null" }, 400);
        if (typeof url === 'string' && !/^https?:\/\/\S+$/.test(url))
          return json({ error: "'avatar_url' must be a valid URL" }, 400);
        account.user.avatarUrl = url;
      }
      return json({ user: account.user } satisfies UserResponse);
    }

    // A wrong current password is a 401 while the session is still fine, which the app must not take for a lost session.
    case 'POST /api/account/password': {
      const account = accounts.find(({ user }) => user.id === state.sessionUserId);
      if (!account) return json({ error: 'Unauthorized Access' }, 401);
      const [current, next] = [textField(body, 'current_password'), textField(body, 'new_password')];
      if (!current || !next) return json({ error: 'Current password and new password are required' }, 400);
      if (current !== account.password) return json({ error: 'Current password is incorrect' }, 401);
      const problem = passwordProblem(next);
      if (problem) return json({ error: problem }, 400);
      account.password = next;
      return noContent();
    }

    case 'DELETE /api/account/me': {
      const account = accounts.find(({ user }) => user.id === state.sessionUserId);
      if (!account) return json({ error: 'Unauthorized Access' }, 401);
      if (!textField(body, 'password')) return json({ error: 'Password is required' }, 400);
      if (textField(body, 'password') !== account.password) return json({ error: 'Password is incorrect' }, 401);
      if (state.deletionBlockedBy.length > 0) {
        return json(
          {
            error:
              'You are the only admin of a group room that still has other members. Make someone else an admin or delete the room first',
            chatIds: state.deletionBlockedBy,
          } satisfies DeleteAccountConflictBody,
          409,
        );
      }
      accounts.splice(accounts.indexOf(account), 1);
      state.sessionUserId = null;
      return noContent();
    }

    default:
      return undefined;
  }
}
