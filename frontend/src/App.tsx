import type { ReactNode } from 'react';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { SocketContext } from '@/lib/useSocket';
import type { AppSocket } from '@/lib/socket';
import type { createAppRouter } from './router';

/**
 * The providers around the app, written once: main.tsx and the tests' `renderApp` both render this,
 * so a provider added here is in the tests too. `children` go next to the router, inside the query
 * provider (main.tsx puts the query devtools there).
 */
export function App({
  queryClient,
  router,
  socket,
  children,
}: {
  queryClient: QueryClient;
  router: ReturnType<typeof createAppRouter>;
  socket: AppSocket;
  children?: ReactNode;
}) {
  return (
    <QueryClientProvider client={queryClient}>
      <SocketContext.Provider value={socket}>
        <RouterProvider router={router} />
        {children}
      </SocketContext.Provider>
    </QueryClientProvider>
  );
}
