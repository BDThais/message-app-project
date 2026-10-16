import { createFileRoute } from '@tanstack/react-router';
import { ResetPasswordForm } from '../features/account/components/ResetPasswordForm';

// Not inside `_guest` or `_app`: the link in the mail has to work whether or not the person is signed in.
export const Route = createFileRoute('/reset-password')({
  component: ResetPasswordForm,
});
