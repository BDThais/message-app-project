import { StrictMode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { render } from '@testing-library/react';
import { createApp } from '../../src/createApp';

/**
 * Renders the real app (router, guards, query client, screens) at `path`, in memory. `strict`
 * wraps it in StrictMode like main.tsx does, which runs every effect twice in development.
 */
export function renderApp(path: string, { strict = false }: { strict?: boolean } = {}) {
  const { queryClient, router } = createApp({ history: createMemoryHistory({ initialEntries: [path] }) });
  const app = (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
  render(strict ? <StrictMode>{app}</StrictMode> : app);
  return { router, queryClient };
}
