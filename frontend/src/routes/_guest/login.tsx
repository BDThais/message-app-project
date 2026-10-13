import { useState, type SyntheticEvent } from 'react';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { safeRedirectPath } from '../../features/account/guards';
import { useLogin } from '../../features/account/queries';

export const Route = createFileRoute('/_guest/login')({
  // `redirect` is where the _app guard was sending the person when it bounced them here.
  validateSearch: (search: Record<string, unknown>): { redirect?: string } =>
    typeof search.redirect === 'string' ? { redirect: search.redirect } : {},
  component: LoginPage,
});

// A thin first version, to prove the guard, the cookie and the cache work together end to end.
// The real sign-in screens (validation messages, signup, forgot password) come in step 2 of
// frontend-planning-doc.md.
function LoginPage() {
  const router = useRouter();
  const { redirect } = Route.useSearch();
  const login = useLogin();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  function handleSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    login.mutate(
      { email, password },
      {
        // The cache already knows the user (see useLogin), so the _app guard lets this through.
        onSuccess: () => router.history.push(safeRedirectPath(redirect)),
      },
    );
  }

  return (
    <>
      <h1>Sign in</h1>
      <form onSubmit={handleSubmit} className="form">
        <label>
          Email
          <input
            type="email"
            name="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label>
          Password
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {login.error && (
          <p role="alert" className="form-error">
            {login.error.message}
          </p>
        )}
        <button type="submit" disabled={login.isPending}>
          {login.isPending ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </>
  );
}
