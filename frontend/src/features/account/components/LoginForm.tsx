import { useState, type SyntheticEvent } from 'react';
import { Link, useRouter } from '@tanstack/react-router';
import { TextField } from '@/components/ui/TextField';
import { Button } from '@/components/ui/Button';
import { Form } from '@/components/ui/Form';
import { FormLinks } from '@/components/ui/FormLinks';
import { Notice } from '@/components/ui/Notice';
import { safeRedirectPath } from '../guards';
import { useLogin } from '../queries';

interface LoginFormProps {
  /** Where the `_app` guard was sending the person when it bounced them here (the `redirect` search parameter). */
  redirectTo: string | undefined;
}

export function LoginForm({ redirectTo }: LoginFormProps) {
  const router = useRouter();
  const login = useLogin();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  function handleSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    login.mutate(
      { email, password },
      {
        // The cache already knows the user (see useLogin), so the _app guard lets this through.
        onSuccess: () => router.history.push(safeRedirectPath(redirectTo)),
      },
    );
  }

  return (
    <>
      <h1>Sign in</h1>
      <Form onSubmit={handleSubmit}>
        <TextField
          label="Email"
          type="email"
          name="email"
          autoComplete="username"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <TextField
          label="Password"
          type="password"
          name="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        {login.error && <Notice tone="error" role="alert">{login.error.message}</Notice>}
        <Button type="submit" fullWidth disabled={login.isPending}>
          {login.isPending ? 'Signing in…' : 'Sign in'}
        </Button>
      </Form>
      <FormLinks>
        <Link to="/signup">Create an account</Link>
        <Link to="/forgot-password">Forgot your password?</Link>
      </FormLinks>
    </>
  );
}
