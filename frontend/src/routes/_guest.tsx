import { createFileRoute, Outlet } from '@tanstack/react-router';
import { redirectIfSignedIn } from '../features/account/guards';

// Pages for people who are not signed in (login, signup, "forgot password").
// The pages the emailed links open (/verify-email, /reset-password) are NOT in here: they have to
// work whether or not the person is signed in.
export const Route = createFileRoute('/_guest')({
  beforeLoad: ({ context }) => redirectIfSignedIn(context.queryClient),
  component: () => (
    <main className="page page-narrow">
      <Outlet />
    </main>
  ),
});
