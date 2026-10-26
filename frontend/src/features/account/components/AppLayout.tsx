import { Outlet } from '@tanstack/react-router';
import { Button } from '@/components/ui/Button';
import { Logo } from '@/components/ui/Logo';
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
    <div className="flex h-dvh flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-line bg-surface px-4 py-2.5 sm:px-6">
        <Logo />
        <div className="flex min-w-0 items-center gap-3">
          <span className="truncate text-sm text-muted">{user.name}</span>
          <Button type="button" size="sm" variant="secondary" disabled={isSigningOut} onClick={signOut}>
            Sign out
          </Button>
        </div>
      </header>
      {!user.emailVerified && <VerifyEmailBanner email={user.email} />}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <Outlet />
      </div>
    </div>
  );
}
