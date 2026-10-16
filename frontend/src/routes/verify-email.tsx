import { createFileRoute } from '@tanstack/react-router';
import { VerifyEmailPage } from '../features/account/components/VerifyEmailPage';

// Not inside `_guest` or `_app`: the link in the mail has to work whether or not the person is signed in.
export const Route = createFileRoute('/verify-email')({
  component: VerifyEmailPage,
});
