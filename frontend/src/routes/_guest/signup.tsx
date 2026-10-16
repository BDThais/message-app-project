import { createFileRoute } from '@tanstack/react-router';
import { SignupForm } from '../../features/account/components/SignupForm';

export const Route = createFileRoute('/_guest/signup')({
  component: SignupForm,
});
