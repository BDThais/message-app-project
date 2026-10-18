import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, Link, Outlet } from '@tanstack/react-router';
import { Page } from '@/components/ui/Page';

// What every route's `beforeLoad` can read from `context` (supplied in router.tsx).
interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: Outlet,
  notFoundComponent: NotFound,
});

function NotFound() {
  return (
    <Page narrow>
      <h1>Page not found</h1>
      <p>
        <Link to="/chat">Go to your chats</Link>
      </p>
    </Page>
  );
}
