import { Outlet } from '@tanstack/react-router';
import { useMe, useSignOut } from '../queries';
import { useRedirectWhenSignedOut } from '../useRedirectWhenSignedOut';
import { VerifyEmailBanner } from './VerifyEmailBanner';

/** The frame around every page for a signed-in user (the `_app` route): header, banner, the page itself. */
export function AppLayout() {
  const { data: user } = useMe();
  const { signOut, isSigningOut } = useSignOut();

  useRedirectWhenSignedOut(user, { isSigningOut });

  if (!user) return null;

  return (
    <div className="app-shell">
      <header className="app-header">
        <strong>Message App</strong>
        <span className="app-header-user">
          {user.name}
          <button type="button" disabled={isSigningOut} onClick={signOut}>
            Sign out
          </button>
        </span>
      </header>
      {!user.emailVerified && <VerifyEmailBanner email={user.email} />}
      <Outlet />
    </div>
  );
}
