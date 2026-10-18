import { useRef } from 'react';
import { Outlet } from '@tanstack/react-router';
import { useLogout, useMe } from '../queries';
import { useRedirectWhenSignedOut } from '../useRedirectWhenSignedOut';
import { VerifyEmailBanner } from './VerifyEmailBanner';

/** The frame around every page for a signed-in user (the `_app` route): header, banner, the page itself. */
export function AppLayout() {
  const { data: user } = useMe();
  const logout = useLogout();
  // True from the moment the person clicks "Sign out", so that case does not get a `redirect`.
  const signingOut = useRef(false);

  useRedirectWhenSignedOut(user, signingOut);

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
