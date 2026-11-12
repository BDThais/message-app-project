import { StrictMode } from 'react';
import { createMemoryHistory } from '@tanstack/react-router';
import { render } from '@testing-library/react';
import { App } from '@/App';
import { createApp } from '@/createApp';
import { FakeSocket } from './fakeSocket';

/**
 * Renders the real app (router, guards, query client, screens) at `path`, in memory. It renders the
 * same `App` as main.tsx, so the providers are the real ones. `strict` wraps it in StrictMode like
 * main.tsx does, which runs every effect twice in development. The socket is a `FakeSocket`, which the
 * test plays the server of: no test opens a real connection.
 */
export function renderApp(path: string, { strict = false }: { strict?: boolean } = {}) {
  const socket = new FakeSocket();
  const { queryClient, router } = createApp({
    history: createMemoryHistory({ initialEntries: [path] }),
    socket: socket.asAppSocket(),
  });
  const app = <App queryClient={queryClient} router={router} socket={socket.asAppSocket()} />;
  render(strict ? <StrictMode>{app}</StrictMode> : app);
  return { router, queryClient, socket };
}
