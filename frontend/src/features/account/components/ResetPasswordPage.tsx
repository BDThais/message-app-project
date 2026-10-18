import { useState, type SyntheticEvent } from 'react';
import { Link } from '@tanstack/react-router';
import { TextField } from '../../../components/ui/TextField';
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
      <p>
        <Link to="/forgot-password">Send me a new link</Link>
      </p>
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
        <p role="status">Your password was changed and every device was signed out. Sign in with the new password.</p>
        <p>
          <Link to="/login">Sign in</Link>
        </p>
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
      <form onSubmit={handleSubmit} className="form">
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
        {reset.error && (
          <p role="alert" className="form-error">
            {reset.error.message}
          </p>
        )}
        <button type="submit" disabled={reset.isPending}>
          {reset.isPending ? 'Saving…' : 'Change password'}
        </button>
      </form>
      <p className="form-links">
        <Link to="/forgot-password">Link expired? Send me a new one</Link>
      </p>
    </>
  );
}
