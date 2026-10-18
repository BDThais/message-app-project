import { createFileRoute } from '@tanstack/react-router';
import { ResetPasswordPage } from '@/features/account/components/ResetPasswordPage';

// In `_public`, not in `_guest` or `_app`: the link in the mail has to work whether or not the person is signed in.
export const Route = createFileRoute('/_public/reset-password')({
  component: ResetPasswordPage,
});
