import { Link, Outlet } from '@tanstack/react-router';
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
      <header className="flex flex-wrap items-center gap-x-6 gap-y-1 border-b border-line bg-surface px-4 py-2.5 sm:px-6">
        <Logo />
        <nav
          aria-label="Main"
          className="order-last -mx-2 flex basis-full items-center gap-1 sm:order-none sm:mx-0 sm:basis-auto"
        >
          <NavLink to="/chat">Chats</NavLink>
          <NavLink to="/friends">Friends</NavLink>
          <NavLink to="/settings">Settings</NavLink>
        </nav>
        <div className="ml-auto flex min-w-0 items-center gap-3">
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

/** A link of the main navigation; the router marks the one for the current page (and the pages below it) with `aria-current`. */
function NavLink({ to, children }: { to: '/chat' | '/friends' | '/settings'; children: string }) {
  return (
    <Link
      to={to}
      className="rounded-md px-2.5 py-1.5 text-sm font-medium text-muted no-underline hover:bg-sunken hover:text-fg aria-[current=page]:bg-accent-soft aria-[current=page]:text-fg"
    >
      {children}
    </Link>
  );
}
