import { useResendVerificationEmail } from '../queries';

/**
 * Shown in the `_app` layout while the signed-in user's address is unverified. Nothing in the app is
 * blocked for an unverified account (only a password reset needs a verified address), so this is
 * a reminder with a resend button, not a gate.
 */
export function VerifyEmailBanner({ email }: { email: string }) {
  const resend = useResendVerificationEmail();

  return (
    <aside className="banner" aria-label="Email verification">
      <p>
        Your email address <strong>{email}</strong> is not verified yet.
      </p>
      <button type="button" disabled={resend.isPending} onClick={() => resend.mutate()}>
        {resend.isPending ? 'Sending…' : 'Resend verification email'}
      </button>
      {resend.isSuccess && (
        <p role="status">Verification email sent. It can take a few minutes; check your spam folder too.</p>
      )}
      {resend.error && (
        <p role="alert" className="form-error">
          {resend.error.message}
        </p>
      )}
    </aside>
  );
}
