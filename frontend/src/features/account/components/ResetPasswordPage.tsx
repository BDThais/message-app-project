import { useState, type SyntheticEvent } from 'react';
import { Link } from '@tanstack/react-router';
import { TextField } from '@/components/ui/TextField';
import { Button } from '@/components/ui/Button';
import { Form } from '@/components/ui/Form';
import { FormLinks } from '@/components/ui/FormLinks';
import { Notice } from '@/components/ui/Notice';
import { useFragmentToken } from '../fragmentToken';
import { PASSWORD_HINT } from '../hints';
import { useResetPassword } from '../queries';

/** The page the reset mail links to (`/reset-password#token=...`). It works signed in or out. */
export function ResetPasswordPage() {
  const token = useFragmentToken();

  return token === null ? <IncompleteLink /> : <NewPasswordForm token={token} />;
}

function IncompleteLink() {
  return (
    <>
      <h1>Choose a new password</h1>
      <p>This link is incomplete. Open the link from the email again, or ask for a new one.</p>
      <FormLinks>
        <Link to="/forgot-password">Send me a new link</Link>
      </FormLinks>
    </>
  );
}

// `token` is a prop, so it stays here after the fragment has left the address bar: a refused
// password (the server checks it before it uses up the link) can be corrected and sent again.
function NewPasswordForm({ token }: { token: string }) {
  const reset = useResetPassword();
  const [newPassword, setNewPassword] = useState('');

  if (reset.isSuccess) {
    return (
      <>
        <h1>Password changed</h1>
        <Notice tone="success" role="status">
          Your password was changed and every device was signed out. Sign in with the new password.
        </Notice>
        <FormLinks>
          <Link to="/login">Sign in</Link>
        </FormLinks>
      </>
    );
  }

  function handleSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    reset.mutate({ token, newPassword });
  }

  return (
    <>
      <h1>Choose a new password</h1>
      <Form onSubmit={handleSubmit}>
        <TextField
          label="New password"
          type="password"
          name="new-password"
          autoComplete="new-password"
          required
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
          hint={PASSWORD_HINT}
        />
        {reset.error && <Notice tone="error" role="alert">{reset.error.message}</Notice>}
        <Button type="submit" fullWidth disabled={reset.isPending}>
          {reset.isPending ? 'Saving…' : 'Change password'}
        </Button>
      </Form>
      <FormLinks>
        <Link to="/forgot-password">Link expired? Send me a new one</Link>
      </FormLinks>
    </>
  );
}
