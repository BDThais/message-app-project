import { createFileRoute } from '@tanstack/react-router';
import { ForgotPasswordForm } from '@/features/account/components/ForgotPasswordForm';

export const Route = createFileRoute('/_guest/forgot-password')({
  component: ForgotPasswordForm,
});
