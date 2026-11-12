// @vitest-environment jsdom
import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bea, carl, john, PASSWORD, stubApi } from './helpers/fakeApi';
import { renderApp } from './helpers/renderApp';

// The connection itself, through the real app and a FakeSocket: when it is open, what it does on a
// reconnect, and what a refused or closed socket means for the session. What the events do to the
// screens is in chatEvents.test.tsx; the friends' events are at the end of this file.

beforeEach(() => {
  window.scrollTo = vi.fn(); // jsdom has none, and the router scrolls to the top on navigation
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const section = async (name: string) => within(await screen.findByRole('region', { name }));
/** Lets what an event started finish before a check that something did NOT happen (see chatEvents.test.tsx). */
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 60)));

describe('opening and closing the socket', () => {
  it.each(['/login', '/signup', '/forgot-password'])(
    'stays closed for a visitor who is not signed in (%s)',
    async (path) => {
      stubApi();
      const { socket } = renderApp(path);
      await screen.findByRole('heading', { level: 1 });

      expect(socket.opened).toBe(0);
      expect(socket.connected).toBe(false);
    },
  );

  it('opens once somebody is signed in, and listens to the events of every feature', async () => {
    stubApi({ signedIn: true });
    const { socket } = renderApp('/chat');
    await screen.findByRole('navigation', { name: 'Chats' });

    expect(socket.opened).toBe(1);
    expect(socket.connected).toBe(true);
    for (const event of [
      'message:new',
      'chat:removed',
      'member:added',
      'read:updated',
      'friend:request',
      'friend:accepted',
    ]) {
      expect(socket.listenerCount(event), event).toBe(1);
    }
  });

  it('opens after signing in, and closes and stops listening on sign-out', async () => {
    stubApi();
    const user = userEvent.setup();
    const { socket } = renderApp('/login');
    await user.type(await screen.findByLabelText('Email'), john.email);
    await user.type(screen.getByLabelText('Password'), PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByRole('navigation', { name: 'Chats' });
    expect(socket.connected).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    await screen.findByRole('heading', { name: 'Sign in' });
    expect(socket.connected).toBe(false);
    expect(socket.listenerCount('message:new')).toBe(0);
    expect(socket.listenerCount('connect')).toBe(0);
  });

  it('is open exactly once in StrictMode, which runs every effect twice', async () => {
    stubApi({ signedIn: true });
    const { socket } = renderApp('/chat', { strict: true });
    await screen.findByRole('navigation', { name: 'Chats' });

    expect(socket.connected).toBe(true);
    expect(socket.opened - socket.closed).toBe(1);
    expect(socket.listenerCount('message:new')).toBe(1);
    expect(socket.listenerCount('connect')).toBe(1);
  });
});

describe('a reconnect', () => {
  it('asks for nothing the first time it connects, and for the lists again after every reconnect', async () => {
    const state = stubApi({ signedIn: true });
    state.addRoom({ id: 1, name: 'Bea' });
    const { socket } = renderApp('/chat');
    await screen.findByRole('link', { name: /Bea/ });
    await settle();
    expect(state.count('GET /api/chat')).toBe(1);

    socket.dropConnection();
    await settle();
    expect(state.count('GET /api/chat')).toBe(1);
    socket.reconnect();

    await waitFor(() => expect(state.count('GET /api/chat')).toBe(2));
    socket.dropConnection();
    socket.reconnect();
    await waitFor(() => expect(state.count('GET /api/chat')).toBe(3));
  });

  it('asks again for the members of a members panel that is open', async () => {
    const state = stubApi({ signedIn: true });
    state.addRoom({
      id: 3,
      type: 'group',
      name: 'Project chat',
      members: [
        { userId: john.id, role: 'admin' },
        { userId: bea.id, role: 'member' },
      ],
    });
    const { socket } = renderApp('/chat/3?members=true');
    await within(await screen.findByRole('region', { name: 'Members' })).findAllByRole('listitem');
    expect(state.count('GET /api/chat/3/member')).toBe(1);

    socket.dropConnection();
    socket.reconnect();

    await waitFor(() => expect(state.count('GET /api/chat/3/member')).toBe(2));
  });

  it('asks again for the friend lists, and never for a search, which is limited', async () => {
    const state = stubApi({ signedIn: true });
    state.friendIds = [bea.id];
    const { socket } = renderApp('/friends');
    await (await section('Your friends')).findByText('Bea');
    const lists = [
      'GET /api/friend',
      'GET /api/friend/requests?direction=incoming',
      'GET /api/friend/requests?direction=outgoing',
    ];
    const before = lists.map((request) => state.count(request));

    socket.dropConnection();
    socket.reconnect();

    await waitFor(() => lists.forEach((request, index) => expect(state.count(request)).toBe(before[index]! + 1)));
    expect(state.requests.some((request) => request.includes('/api/friend/search'))).toBe(false);
  });

  it('drops the conversations that are cached but not on screen, so they load fresh when opened', async () => {
    const state = stubApi({ signedIn: true });
    state.addRoom({ id: 1, name: 'Bea' });
    state.addRoom({ id: 2, name: 'Carl' });
    state.addMessage({ chatId: 1, sender: bea, content: 'from Bea' });
    state.addMessage({ chatId: 2, sender: carl, content: 'from Carl' });
    const user = userEvent.setup();
    const { socket, queryClient } = renderApp('/chat/1');
    await within(await screen.findByRole('log', { name: 'Messages' })).findByText('from Bea');
    await user.click(within(screen.getByRole('navigation', { name: 'Chats' })).getByRole('link', { name: /Carl/ }));
    await within(await screen.findByRole('log', { name: 'Messages' })).findByText('from Carl');
    expect(queryClient.getQueryCache().findAll({ queryKey: ['chats', 'messages', 1] })).toHaveLength(1);

    socket.dropConnection();
    socket.reconnect();

    await waitFor(() =>
      expect(queryClient.getQueryCache().findAll({ queryKey: ['chats', 'messages', 1] })).toHaveLength(0),
    );
    expect(queryClient.getQueryCache().findAll({ queryKey: ['chats', 'messages', 2] })).toHaveLength(1);
  });
});

describe('a socket the session cannot keep', () => {
  it('sends the person to the login page when the handshake is refused because the session is gone', async () => {
    const state = stubApi({ signedIn: true });
    const { socket, router } = renderApp('/chat');
    await screen.findByRole('navigation', { name: 'Chats' });

    state.session = null;
    socket.refuseHandshake();

    await screen.findByRole('heading', { name: 'Sign in' });
    expect(router.state.location.pathname).toBe('/login');
  });

  it('asks who is signed in when the server closes the socket, and stays when the session is fine', async () => {
    const state = stubApi({ signedIn: true });
    const { socket } = renderApp('/chat');
    await screen.findByRole('navigation', { name: 'Chats' });
    expect(state.count('GET /api/account/me')).toBe(1);

    socket.serverCloses();

    await waitFor(() => expect(state.count('GET /api/account/me')).toBe(2));
    expect(screen.getByRole('navigation', { name: 'Chats' })).toBeTruthy();
  });

  it('does not ask who is signed in when the connection is merely lost: the client reconnects by itself', async () => {
    const state = stubApi({ signedIn: true });
    const { socket } = renderApp('/chat');
    await screen.findByRole('navigation', { name: 'Chats' });

    socket.dropConnection();
    await settle();

    expect(state.count('GET /api/account/me')).toBe(1);
  });

  it('leaves for the login page when the server closes the socket because the session ended', async () => {
    const state = stubApi({ signedIn: true });
    const { socket } = renderApp('/chat');
    await screen.findByRole('navigation', { name: 'Chats' });

    state.session = null;
    socket.serverCloses();

    await screen.findByRole('heading', { name: 'Sign in' });
    // Nobody is signed in any more, so it is not opened again (a handshake that would be refused) on the way out.
    expect(socket.opened).toBe(1);
    expect(socket.connected).toBe(false);
  });

  it('does not take the socket that the server closes for a sign-out the person asked for as a session that ended', async () => {
    stubApi({ signedIn: true });
    const user = userEvent.setup();
    const { socket, router } = renderApp('/settings');
    await screen.findByRole('navigation', { name: 'Main' });

    // The server closes the socket while it handles the sign-out, before the answer reaches the page.
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    socket.serverCloses();

    await screen.findByRole('heading', { name: 'Sign in' });
    expect(router.state.location.href).toBe('/login');
  });

  it('does not ask who is signed in when the person closed the socket themself', async () => {
    const state = stubApi({ signedIn: true });
    const user = userEvent.setup();
    renderApp('/chat');
    await screen.findByRole('navigation', { name: 'Chats' });

    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    await screen.findByRole('heading', { name: 'Sign in' });

    expect(state.count('GET /api/account/me')).toBe(1);
  });
});

describe('friend events', () => {
  it('shows a request somebody sent, without a search and without leaving the page', async () => {
    const state = stubApi({ signedIn: true });
    const { socket } = renderApp('/friends');
    await (await section('Friend requests')).findByText('No one is waiting for an answer.');

    const request = state.addFriendRequest({ from: carl, to: john });
    socket.serverSends('friend:request', {
      request: { id: request.id, createdAt: request.createdAt, user: { id: carl.id, name: 'Carl', avatarUrl: null } },
    });

    expect(await (await section('Friend requests')).findByText('Carl')).toBeTruthy();
    expect(state.requests.some((request) => request.includes('/api/friend/search'))).toBe(false);
  });

  it('shows a new friend when the other person accepts, and the request is gone from the list of the ones sent', async () => {
    const state = stubApi({ signedIn: true });
    const sent = state.addFriendRequest({ from: john, to: bea });
    const { socket } = renderApp('/friends');
    await (await section('Requests you sent')).findByText('Bea');

    state.friendRequests = state.friendRequests.filter(({ id }) => id !== sent.id);
    state.friendIds.push(bea.id);
    socket.serverSends('friend:accepted', { friend: { id: bea.id, name: 'Bea', avatarUrl: null } });

    expect(await (await section('Your friends')).findByText('Bea')).toBeTruthy();
    await waitFor(() =>
      expect(within(screen.getByRole('region', { name: 'Requests you sent' })).queryByText('Bea')).toBeNull(),
    );
  });

  it('asks for the lists of a page that is not open only when it is opened', async () => {
    const state = stubApi({ signedIn: true });
    const { socket } = renderApp('/chat');
    await screen.findByRole('navigation', { name: 'Chats' });

    socket.serverSends('friend:request', {
      request: { id: 1, createdAt: '2026-10-20T09:00:00.000Z', user: { id: carl.id, name: 'Carl', avatarUrl: null } },
    });

    await settle();
    expect(state.requests.filter((request) => request.startsWith('GET /api/friend'))).toEqual([]);
  });
});
