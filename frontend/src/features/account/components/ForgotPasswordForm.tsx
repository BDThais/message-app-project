import { useState, type SyntheticEvent } from 'react';
import { Link } from '@tanstack/react-router';
import { TextField } from '@/components/ui/TextField';
import { Button } from '@/components/ui/Button';
import { Form } from '@/components/ui/Form';
import { FormLinks } from '@/components/ui/FormLinks';
import { Notice } from '@/components/ui/Notice';
import { useRequestPasswordReset } from '../queries';

export function ForgotPasswordForm() {
  const request = useRequestPasswordReset();
  const [email, setEmail] = useState('');

  // The server answers the same for every well-formed address, whether or not an account has it, so
  // this screen must not promise that a mail was sent (and must not read differently for an unknown address).
  if (request.isSuccess) return <ResetRequested email={request.variables} />;

  function handleSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    request.mutate(email);
  }

  return (
    <>
      <h1>Forgot your password?</h1>
      <Form onSubmit={handleSubmit}>
        <TextField
          label="Email"
          type="email"
          name="email"
          autoComplete="username"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          hint="The address you signed up with."
        />
        {request.error && <Notice tone="error" role="alert">{request.error.message}</Notice>}
        <Button type="submit" fullWidth disabled={request.isPending}>
          {request.isPending ? 'Sending…' : 'Send reset link'}
        </Button>
      </Form>
      <FormLinks>
        <Link to="/login">Back to sign in</Link>
      </FormLinks>
    </>
  );
}

function ResetRequested({ email }: { email: string }) {
  return (
    <>
      <h1>Check your email</h1>
      <p>
        If an account exists for <strong>{email}</strong>, a reset link is on its way.
      </p>
      <p>
        It can take a few minutes. If nothing arrives, check your spam folder, wait a minute and try again. If that
        address was never verified, the mail holds a verification link instead: verify it first, then ask for a new reset
        link.
      </p>
      <FormLinks>
        <Link to="/login">Back to sign in</Link>
      </FormLinks>
    </>
  );
}
