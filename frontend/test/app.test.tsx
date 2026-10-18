// @vitest-environment jsdom
import { MutationObserver } from '@tanstack/react-query';
import { createMemoryHistory } from '@tanstack/react-router';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '@/createApp';
import { api } from '@/lib/http';
import { john, PASSWORD, stubApi } from './helpers/fakeApi';
import { renderApp } from './helpers/renderApp';

// The whole sign-in loop through the real router, guards, query client and screens, against a fake
// API (a stubbed fetch, see helpers/fakeApi.ts). It covers what the unit tests cannot: that the
// pieces work together. The other account screens (signup, mailed links, the banner) are in
// accountScreens.test.tsx.

async function signIn(user: ReturnType<typeof userEvent.setup>, password = PASSWORD) {
  await user.type(await screen.findByLabelText('Email'), john.email);
  await user.type(screen.getByLabelText('Password'), password);
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
}

beforeEach(() => {
  window.scrollTo = vi.fn(); // jsdom has none, and the router scrolls to the top on navigation
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the app', () => {
  it('sends a signed-out visitor from a private page to /login, and back after signing in', async () => {
    stubApi();
    const user = userEvent.setup();
    const { router } = renderApp('/chat');

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeTruthy();
    expect(router.state.location.pathname).toBe('/login');
    expect(router.state.location.search).toEqual({ redirect: '/chat' });

    await signIn(user);

    expect(await screen.findByText(`Signed in as ${john.email}.`)).toBeTruthy();
    expect(router.state.location.pathname).toBe('/chat');
  });

  it('redirects before anything renders: the router itself refuses a signed-out visitor', async () => {
    stubApi();
    const { router } = createApp({ history: createMemoryHistory({ initialEntries: ['/chat'] }) });

    await router.load();

    expect(router.state.location.pathname).toBe('/login');
    expect(router.state.location.search).toEqual({ redirect: '/chat' });
  });

  it('ignores a redirect that points off the site', async () => {
    stubApi();
    const user = userEvent.setup();
    const { router } = renderApp('/login?redirect=https%3A%2F%2Fevil.example%2Fchat');

    await signIn(user);

    await waitFor(() => expect(router.state.location.pathname).toBe('/chat'));
  });

  it('returns to the deep link that was asked for, not just /chat', async () => {
    stubApi();
    const user = userEvent.setup();
    const { router } = renderApp('/login?redirect=%2Fchat%3Ftab%3Dmembers');

    await signIn(user);

    await waitFor(() => expect(router.state.location.pathname).toBe('/chat'));
    expect(router.state.location.search).toEqual({ tab: 'members' });
  });

  it('shows the answer for wrong credentials and stays on the login page', async () => {
    stubApi();
    const user = userEvent.setup();
    const { router } = renderApp('/login');

    await signIn(user, 'wrong');

    expect((await screen.findByRole('alert')).textContent).toBe('Invalid email or password');
    expect(router.state.location.pathname).toBe('/login');
  });

  it('keeps a signed-in user off the login page, and "/" leads to their chats', async () => {
    stubApi({ signedIn: true });
    const { router } = renderApp('/login');

    expect(await screen.findByRole('heading', { name: 'Chats' })).toBeTruthy();
    expect(router.state.location.pathname).toBe('/chat');

    await router.navigate({ to: '/' });
    await waitFor(() => expect(router.state.location.pathname).toBe('/chat'));
  });

  it('signs out, clears what was cached for that user, and returns to /login', async () => {
    const api = stubApi({ signedIn: true });
    const user = userEvent.setup();
    const { router, queryClient } = renderApp('/chat');
    queryClient.setQueryData(['chats'], [{ id: 1 }]); // stands in for the previous user's data

    await user.click(await screen.findByRole('button', { name: 'Sign out' }));

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeTruthy();
    expect(router.state.location.pathname).toBe('/login');
    expect(router.state.location.search).toEqual({}); // signing out on purpose is not "come back here"
    expect(api.session).toBeNull();
    expect(queryClient.getQueryData(['chats'])).toBeUndefined();
  });

  it('sends the user to /login when a request is answered 401 because the session ended', async () => {
    const server = stubApi({ signedIn: true });
    const { router, queryClient } = renderApp('/chat');
    await screen.findByRole('heading', { name: 'Chats' });

    // The server forgets the session (it expired). The next request answers 401, the app looks at
    // GET /account/me again (see createApp), and that now says nobody is signed in.
    server.session = null;
    await expect(queryClient.query({ queryKey: ['chats'], queryFn: () => api.get('/chat') })).rejects.toThrow();

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeTruthy();
    expect(router.state.location.pathname).toBe('/login');
    expect(router.state.location.search).toEqual({ redirect: '/chat' });
  });

  it('stays signed in when a 401 does not mean the session ended (a wrong current password)', async () => {
    const server = stubApi({ signedIn: true });
    const { router, queryClient } = renderApp('/chat');
    await screen.findByRole('heading', { name: 'Chats' });
    const meRequests = () => server.requests.filter((request) => request === 'GET /api/account/me').length;
    expect(meRequests()).toBe(1);

    const changePassword = new MutationObserver(queryClient, {
      mutationFn: () => api.post('/account/password', { current_password: 'wrong', new_password: PASSWORD }),
    });
    await expect(changePassword.mutate()).rejects.toThrow('Current password is wrong');

    // The app asked again, was told the session is fine, and left the person where they were.
    await waitFor(() => expect(meRequests()).toBe(2));
    expect(screen.getByRole('heading', { name: 'Chats' })).toBeTruthy();
    expect(router.state.location.pathname).toBe('/chat');
  });
});

describe('the route tree', () => {
  it('shows /chat inside the chat layout, where the room-list sidebar goes in step 3', async () => {
    stubApi({ signedIn: true });
    const { router } = renderApp('/chat');

    await screen.findByRole('heading', { name: 'Chats' });
    expect(router.state.matches.map((match) => match.routeId)).toEqual([
      '__root__',
      '/_app',
      '/_app/chat',
      '/_app/chat/',
    ]);
  });
});
