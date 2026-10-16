import { createFileRoute } from '@tanstack/react-router';
import { LoginForm } from '../../features/account/components/LoginForm';

export const Route = createFileRoute('/_guest/login')({
  // `redirect` is where the _app guard was sending the person when it bounced them here.
  validateSearch: (search: Record<string, unknown>): { redirect?: string } =>
    typeof search.redirect === 'string' ? { redirect: search.redirect } : {},
  component: LoginPage,
});

function LoginPage() {
  const { redirect } = Route.useSearch();
  return <LoginForm redirectTo={redirect} />;
}
