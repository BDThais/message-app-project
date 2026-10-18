import { StrictMode } from 'react';
import { createMemoryHistory } from '@tanstack/react-router';
import { render } from '@testing-library/react';
import { App } from '@/App';
import { createApp } from '@/createApp';

/**
 * Renders the real app (router, guards, query client, screens) at `path`, in memory. It renders the
 * same `App` as main.tsx, so the providers are the real ones. `strict` wraps it in StrictMode like
 * main.tsx does, which runs every effect twice in development.
 */
export function renderApp(path: string, { strict = false }: { strict?: boolean } = {}) {
  const { queryClient, router } = createApp({ history: createMemoryHistory({ initialEntries: [path] }) });
  const app = <App queryClient={queryClient} router={router} />;
  render(strict ? <StrictMode>{app}</StrictMode> : app);
  return { router, queryClient };
}
