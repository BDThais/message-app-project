import { useEffect, useRef } from 'react';
import { Link } from '@tanstack/react-router';
import { useFragmentToken } from '../fragmentToken';
import { useVerifyEmail } from '../queries';

/**
 * The page the verification mail links to (`/verify-email#token=...`). It works signed in or out.
 * The token is posted as soon as the page opens, as the link is the person's click; it has to be a
 * POST and not a GET, because mail scanners and link previewers open links on their own.
 */
export function VerifyEmailPage() {
  const token = useFragmentToken();
  const { mutate, isSuccess, error } = useVerifyEmail();
  // A link works once. React's StrictMode runs effects twice in development, and a second request
  // would answer "invalid or expired" for a link that has just worked.
  const started = useRef(false);

  useEffect(() => {
    if (token === null || started.current) return;
    started.current = true;
    mutate(token);
  }, [token, mutate]);

  return (
    <main className="page page-narrow">
      <h1>Verify your email</h1>
      {token === null ? (
        <p>
          This link is incomplete. Open the link from the email again; if that does not work, sign in and use the button
          in the banner at the top of the page to send a new one.
        </p>
      ) : isSuccess ? (
        <p role="status">Your email address is verified.</p>
      ) : error ? (
        <>
          <p role="alert" className="form-error">
            {error.message}
          </p>
          <p>If the link has expired, sign in and use the button in the banner at the top of the page to send a new one.</p>
        </>
      ) : (
        <p role="status">Verifying your email address…</p>
      )}
      <p>
        <Link to="/chat">Continue</Link>
      </p>
    </main>
  );
}
