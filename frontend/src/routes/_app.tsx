import { useEffect, useRef } from 'react';
import { createFileRoute, Outlet, useRouter } from '@tanstack/react-router';
import { requireUser } from '../features/account/guards';
import { VerifyEmailBanner } from '../features/account/components/VerifyEmailBanner';
import { useLogout, useMe } from '../features/account/queries';

// Everything behind this layout needs a signed-in user.
export const Route = createFileRoute('/_app')({
  // Runs before anything below renders, on every navigation into this layout.
  beforeLoad: ({ context, location }) => requireUser(context.queryClient, location.href),
  component: AppLayout,
});

function AppLayout() {
  const router = useRouter();
  const { data: user } = useMe();
  const logout = useLogout();
  // True from the moment the person clicks "Sign out", so that case does not get a `redirect`.
  const signingOut = useRef(false);

  // The guard above only runs when navigating. If the session ends while the page is open (a request
  // answered 401 and GET /account/me then came back empty, or this person signed out), the cached
  // user becomes null and this sends them to the login page. The page they were on is read from the
  // router here, once, and not from a hook: a value that changes with the location would make this
  // effect run again for the /login URL it has just navigated to.
  useEffect(() => {
    if (user !== null) return;
    void router.navigate(
      signingOut.current ? { to: '/login' } : { to: '/login', search: { redirect: router.state.location.href } },
    );
  }, [user, router]);

  if (!user) return null;

  return (
    <div className="app-shell">
      <header className="app-header">
        <strong>Message App</strong>
        <span className="app-header-user">
          {user.name}
          <button
            type="button"
            disabled={logout.isPending}
            onClick={() => {
              signingOut.current = true;
              logout.mutate(undefined, {
                onError: () => {
                  signingOut.current = false;
                },
              });
            }}
          >
            Sign out
          </button>
        </span>
      </header>
      {!user.emailVerified && <VerifyEmailBanner email={user.email} />}
      <Outlet />
    </div>
  );
}
