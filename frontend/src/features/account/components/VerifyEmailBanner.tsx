import { Button } from '@/components/ui/Button';
import { useResendVerificationEmail } from '../queries';

/**
 * Shown in the `_app` layout while the signed-in user's address is unverified. Nothing in the app is
 * blocked for an unverified account (only a password reset needs a verified address), so this is
 * a reminder with a resend button, not a gate.
 */
export function VerifyEmailBanner({ email }: { email: string }) {
  const resend = useResendVerificationEmail();

  return (
    <aside
      aria-label="Email verification"
      className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-accent-soft px-4 py-2.5 text-sm sm:px-6"
    >
      <p>
        Your email address <strong>{email}</strong> is not verified yet.
      </p>
      <Button type="button" size="sm" variant="secondary" disabled={resend.isPending} onClick={() => resend.mutate()}>
        {resend.isPending ? 'Sending…' : 'Resend verification email'}
      </Button>
      {resend.isSuccess && (
        <p role="status">Verification email sent. It can take a few minutes; check your spam folder too.</p>
      )}
      {resend.error && (
        <p role="alert" className="text-danger">
          {resend.error.message}
        </p>
      )}
    </aside>
  );
}
