import { createFileRoute } from '@tanstack/react-router';
import { VerifyEmailPage } from '@/features/account/components/VerifyEmailPage';

// In `_public`, not in `_guest` or `_app`: the link in the mail has to work whether or not the person is signed in.
export const Route = createFileRoute('/_public/verify-email')({
  component: VerifyEmailPage,
});
