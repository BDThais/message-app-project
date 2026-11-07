// @vitest-environment jsdom
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bea, carl, dana, john, stubApi, tels, type FakeServer } from './helpers/fakeApi';
import { renderApp } from './helpers/renderApp';

// The friends page through the real router, query client and components, against the fake API:
// searching by phone number, the requests in both directions, the friend list and "Message".

type User = ReturnType<typeof userEvent.setup>;

beforeEach(() => {
  window.scrollTo = vi.fn(); // jsdom has none, and the router scrolls to the top on navigation
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Signs John in and opens /friends; `setup` gives the fake server its people before the page asks. */
function openFriends(setup: (state: FakeServer) => void = () => undefined) {
  const state = stubApi({ signedIn: true });
  setup(state);
  const { router } = renderApp('/friends');
  return { state, router };
}

/** A card of the page, once it is there: its heading names it. */
async function section(name: string) {
  return within(await screen.findByRole('region', { name }));
}

async function searchFor(user: User, tel: string) {
  const field = await screen.findByLabelText('Phone number');
  await user.clear(field);
  await user.type(field, tel);
  await user.click(screen.getByRole('button', { name: 'Search' }));
}

/** The page's line of news (a live region that is there all the time), or null while it says nothing. */
function newsLine() {
  const dismiss = screen.queryByRole('button', { name: 'Dismiss' });
  if (!dismiss) return null;
  const region = dismiss.closest('[role="status"]');
  return { text: region?.querySelector('span')?.textContent ?? null, isLiveRegion: region !== null };
}

const namesIn = (list: HTMLElement) => within(list).getAllByRole('listitem').map((item) => item.querySelector('span.font-medium')?.textContent);

describe('the friends page', () => {
  it('lists the friends by name, the requests that came in and the ones that were sent', async () => {
    openFriends((state) => {
      state.friendIds.push(dana.id, bea.id); // not in name order
      state.addFriendRequest({ from: carl, to: john });
    });

    const friends = await section('Your friends');
    expect(namesIn(await friends.findByRole('list'))).toEqual(['Bea', 'Dana']);
    const incoming = await section('Friend requests');
    expect(await incoming.findByText('Carl')).toBeTruthy();
    expect(incoming.getByRole('button', { name: 'Accept Carl' })).toBeTruthy();
    expect(incoming.getByRole('button', { name: 'Reject Carl' })).toBeTruthy();
    expect((await section('Requests you sent')).getByText('You have no requests waiting for an answer.')).toBeTruthy();
  });

  it('says so when there is nothing in a list', async () => {
    openFriends();

    expect(await (await section('Your friends')).findByText(/You have no friends yet/)).toBeTruthy();
    expect(await (await section('Friend requests')).findByText('No one is waiting for an answer.')).toBeTruthy();
  });

  it('shows the newest request first', async () => {
    openFriends((state) => {
      state.addFriendRequest({ from: bea, to: john });
      state.addFriendRequest({ from: carl, to: john });
    });

    const incoming = await section('Friend requests');
    expect(namesIn(await incoming.findByRole('list'))).toEqual(['Carl', 'Bea']);
  });

  it('shows the error of a list with a way to try again, while the other lists still load', async () => {
    const state = stubApi({ signedIn: true });
    state.friendIds.push(bea.id);
    const stubbed = globalThis.fetch;
    let broken = true;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) =>
        broken && url === '/api/friend' ? new Response(JSON.stringify({ error: 'Something broke' }), { status: 400 }) : stubbed(url, init),
      ),
    );
    renderApp('/friends');
    const user = userEvent.setup();

    const friends = await section('Your friends');
    expect((await friends.findByRole('alert')).textContent).toBe('Something broke');
    expect(await (await section('Friend requests')).findByText('No one is waiting for an answer.')).toBeTruthy();

    broken = false;
    await user.click(friends.getByRole('button', { name: 'Try again' }));
    expect(await friends.findByText('Bea')).toBeTruthy();
  });
});

describe('finding someone', () => {
  it('cleans up what was typed, asks for it in the form the server wants, and offers to add them', async () => {
    const { state } = openFriends();
    const user = userEvent.setup();

    await searchFor(user, '+84 (900) 000-002');

    const result = await section('Add a friend');
    expect(await result.findByText('Bea')).toBeTruthy();
    expect(state.requests).toContain('GET /api/friend/search/%2B84900000002');
    expect(result.getByRole('button', { name: 'Add friend' })).toBeTruthy();
  });

  it('sends the request, shows "Request sent" with a way to cancel, and lists it under the requests sent', async () => {
    const { state } = openFriends();
    const user = userEvent.setup();
    await searchFor(user, tels.bea);

    const result = await section('Add a friend');
    await user.click(await result.findByRole('button', { name: 'Add friend' }));

    expect(await result.findByText('Request sent')).toBeTruthy();
    expect(result.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    expect(state.calls.find((call) => call.request === 'POST /api/friend/requests')?.body).toEqual({ receiver_id: bea.id });
    const sent = await section('Requests you sent');
    expect(sent.getByText('Bea')).toBeTruthy();
    // From the answer: neither list was asked for again.
    expect(state.count('GET /api/friend/requests?direction=outgoing')).toBe(1);
    expect(state.count(`GET /api/friend/search/${encodeURIComponent(tels.bea)}`)).toBe(1);
  });

  it('says so when nobody has the number', async () => {
    openFriends();
    const user = userEvent.setup();

    await searchFor(user, '+84999999999');

    expect(await (await section('Add a friend')).findByText('No one has that phone number.')).toBeTruthy();
  });

  it("shows the server's text for a number it refuses, and for a search limit that is used up", async () => {
    const { state } = openFriends();
    const user = userEvent.setup();

    await searchFor(user, '0912345678');
    const result = await section('Add a friend');
    expect((await result.findByRole('alert')).textContent).toContain("'tel' must be a valid phone number in E.164 format");

    state.searchLimited = true;
    await searchFor(user, tels.bea);
    await waitFor(() => expect(result.getByRole('alert').textContent).toBe('Too many searches, try again later'));
  });

  it('does not search again on its own after a failure: the limiter counts every request', async () => {
    const state = stubApi({ signedIn: true });
    const stubbed = globalThis.fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) =>
        url.startsWith('/api/friend/search/') ? new Response(JSON.stringify({ error: 'Something broke' }), { status: 500 }) : stubbed(url, init),
      ),
    );
    renderApp('/friends');
    const user = userEvent.setup();

    await searchFor(user, tels.bea);

    // A 5xx is retried by default, with a delay of seconds, which would keep "Searching…" on screen.
    expect((await (await section('Add a friend')).findByRole('alert')).textContent).toBe('Something broke');
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).startsWith('/api/friend/search/'))).toHaveLength(1);
    expect(state.requests.length).toBeGreaterThan(0);
  });

  it('asks for the lists again when the tab comes back to the front, but never for the search', async () => {
    const { state } = openFriends();
    const user = userEvent.setup();
    await searchFor(user, tels.bea);
    await (await section('Add a friend')).findByText('Bea');
    const searches = state.count(`GET /api/friend/search/${encodeURIComponent(tels.bea)}`);
    const lists = state.count('GET /api/friend');

    window.dispatchEvent(new Event('visibilitychange')); // what TanStack Query listens to

    await waitFor(() => expect(state.count('GET /api/friend')).toBe(lists + 1));
    expect(state.count(`GET /api/friend/search/${encodeURIComponent(tels.bea)}`)).toBe(searches);
  });

  it('does not search for an empty number', async () => {
    const { state } = openFriends();
    const user = userEvent.setup();

    const button = (await screen.findByRole('button', { name: 'Search' })) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    await user.type(screen.getByLabelText('Phone number'), ' - ( ) {Enter}'); // Enter submits a form unless its button is disabled
    expect(button.disabled).toBe(true);
    expect(state.requests.some((request) => request.includes('/api/friend/search'))).toBe(false);
  });

  it('keeps Search disabled while a search runs, so a double click spends one try of the limit', async () => {
    const { state } = openFriends();
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: 'Your friends' });

    let release = () => {};
    state.gate = new Promise<void>((resolve) => (release = resolve));
    await user.type(screen.getByLabelText('Phone number'), tels.bea);
    const button = screen.getByRole('button', { name: 'Search' }) as HTMLButtonElement;
    await user.click(button);
    await waitFor(() => expect(button.disabled).toBe(true));
    await user.click(button);
    release();
    state.gate = null;

    expect(await (await section('Add a friend')).findByText('Bea')).toBeTruthy();
    expect(state.count(`GET /api/friend/search/${encodeURIComponent(tels.bea)}`)).toBe(1);
  });

  it('asks again when the same number is searched again', async () => {
    const { state } = openFriends();
    const user = userEvent.setup();

    await searchFor(user, tels.bea);
    await (await section('Add a friend')).findByText('Bea');
    state.addFriendRequest({ from: bea, to: john }); // Bea sends a request while the card is open
    await searchFor(user, tels.bea);

    expect(await (await section('Add a friend')).findByRole('button', { name: 'Accept' })).toBeTruthy();
    expect(state.count(`GET /api/friend/search/${encodeURIComponent(tels.bea)}`)).toBe(2);
  });

  it.each([
    ['a friend', (state: FakeServer) => state.friendIds.push(bea.id), ['Message']],
    ['someone who sent a request', (state: FakeServer) => state.addFriendRequest({ from: bea, to: john }), ['Accept']],
    ['someone who got a request', (state: FakeServer) => state.addFriendRequest({ from: john, to: bea }), ['Cancel']],
    ['a stranger', () => undefined, ['Add friend']],
  ])('offers the button that fits %s', async (_who, setup, buttons) => {
    openFriends(setup);
    const user = userEvent.setup();

    await searchFor(user, tels.bea);

    const result = await section('Add a friend');
    await result.findByText('Bea');
    const names = result.getAllByRole('button').map((button) => button.textContent);
    expect(names.filter((name) => name !== 'Search')).toEqual(buttons);
  });

  it('shows no button for the person themselves', async () => {
    openFriends();
    const user = userEvent.setup();

    await searchFor(user, john.tel);

    const result = await section('Add a friend');
    expect(await result.findByText('This is you')).toBeTruthy();
    expect(result.getAllByRole('button').map((button) => button.textContent)).toEqual(['Search']);
  });

  it("shows the server's text when it refuses the request, and keeps the button for another try", async () => {
    const { state } = openFriends();
    const user = userEvent.setup();
    await searchFor(user, tels.bea);
    const result = await section('Add a friend');

    state.friendRequestLimited = true;
    await user.click(await result.findByRole('button', { name: 'Add friend' }));

    expect((await result.findByRole('alert')).textContent).toBe('Too many friend requests, try again later');
    expect(result.getByRole('button', { name: 'Add friend' })).toBeTruthy();
    expect(state.friendRequests).toHaveLength(0);
  });

  it('shows the right button when the screen was out of date: they had sent a request already', async () => {
    const { state } = openFriends();
    const user = userEvent.setup();
    await searchFor(user, tels.bea);
    const result = await section('Add a friend');
    await result.findByRole('button', { name: 'Add friend' });

    state.addFriendRequest({ from: bea, to: john }); // while the card was open
    await user.click(result.getByRole('button', { name: 'Add friend' }));

    expect(await result.findByRole('button', { name: 'Accept' })).toBeTruthy();
    expect(result.getByRole('alert').textContent).toBe('This user has already sent you a friend request');
    expect(newsLine()).toBeNull(); // the card is still there with its text, so the page has nothing to add
    // The incoming list learned of it too.
    expect(await (await section('Friend requests')).findByRole('button', { name: 'Accept Bea' })).toBeTruthy();
  });
});

describe('answering and cancelling requests', () => {
  it('accepts a request from the list: the person moves to the friends, in name order, with no list asked for again', async () => {
    const { state } = openFriends((fake) => {
      fake.friendIds.push(dana.id);
      fake.addFriendRequest({ from: carl, to: john });
    });
    const user = userEvent.setup();
    const incoming = await section('Friend requests');

    await user.click(await incoming.findByRole('button', { name: 'Accept Carl' }));

    const friends = await section('Your friends');
    await waitFor(() => expect(namesIn(friends.getByRole('list'))).toEqual(['Carl', 'Dana']));
    expect(await incoming.findByText('No one is waiting for an answer.')).toBeTruthy();
    expect(state.calls.some((call) => call.request === 'POST /api/friend/requests/1/accept')).toBe(true);
    expect(state.count('GET /api/friend')).toBe(1);
    expect(state.count('GET /api/friend/requests?direction=incoming')).toBe(1);
  });

  it('accepts from the search card too, and the card turns into "Message"', async () => {
    const { state } = openFriends((fake) => fake.addFriendRequest({ from: carl, to: john }));
    const user = userEvent.setup();
    await searchFor(user, tels.carl);
    const result = await section('Add a friend');

    await user.click(await result.findByRole('button', { name: 'Accept' }));

    expect(await result.findByRole('button', { name: 'Message' })).toBeTruthy();
    expect(state.friendIds).toEqual([carl.id]);
    expect((await section('Your friends')).getByText('Carl')).toBeTruthy();
    expect((await section('Friend requests')).getByText('No one is waiting for an answer.')).toBeTruthy();
  });

  it('rejects a request: it goes, and nobody becomes a friend', async () => {
    const { state } = openFriends((fake) => fake.addFriendRequest({ from: carl, to: john }));
    const user = userEvent.setup();
    const incoming = await section('Friend requests');

    await user.click(await incoming.findByRole('button', { name: 'Reject Carl' }));

    expect(await incoming.findByText('No one is waiting for an answer.')).toBeTruthy();
    expect(state.calls.some((call) => call.request === 'DELETE /api/friend/requests/1')).toBe(true);
    expect(state.friendIds).toEqual([]);
    expect((await section('Your friends')).getByText(/You have no friends yet/)).toBeTruthy();
  });

  it('rejects a request that a search card shows too: the card goes back to "Add friend"', async () => {
    openFriends((fake) => fake.addFriendRequest({ from: carl, to: john }));
    const user = userEvent.setup();
    await searchFor(user, tels.carl);
    const result = await section('Add a friend');
    await result.findByRole('button', { name: 'Accept' });

    await user.click(await (await section('Friend requests')).findByRole('button', { name: 'Reject Carl' }));

    expect(await result.findByRole('button', { name: 'Add friend' })).toBeTruthy();
  });

  it('cancels a request that was sent, and a search card for the same person goes back to "Add friend"', async () => {
    const { state } = openFriends((fake) => fake.addFriendRequest({ from: john, to: dana }));
    const user = userEvent.setup();
    await searchFor(user, tels.dana);
    const result = await section('Add a friend');
    await result.findByText('Request sent');

    const sent = await section('Requests you sent');
    await user.click(await sent.findByRole('button', { name: 'Cancel request to Dana' }));

    expect(await result.findByRole('button', { name: 'Add friend' })).toBeTruthy();
    expect(sent.getByText('You have no requests waiting for an answer.')).toBeTruthy();
    expect(state.friendRequests).toEqual([]);
  });

  it('cancels from the search card, and the list of requests sent follows', async () => {
    const { state } = openFriends((fake) => fake.addFriendRequest({ from: john, to: dana }));
    const user = userEvent.setup();
    await searchFor(user, tels.dana);
    const result = await section('Add a friend');

    await user.click(await result.findByRole('button', { name: 'Cancel' }));

    expect(await result.findByRole('button', { name: 'Add friend' })).toBeTruthy();
    expect((await section('Requests you sent')).getByText('You have no requests waiting for an answer.')).toBeTruthy();
    expect(state.calls.some((call) => call.request === 'DELETE /api/friend/requests/1')).toBe(true);
  });

  it('drops a request that is no longer there, when it was cancelled while the page was open', async () => {
    const { state } = openFriends((fake) => fake.addFriendRequest({ from: carl, to: john }));
    const user = userEvent.setup();
    const incoming = await section('Friend requests');
    await incoming.findByText('Carl');

    state.friendRequests.length = 0; // Carl took it back
    await user.click(incoming.getByRole('button', { name: 'Accept Carl' }));

    expect(await incoming.findByText('No one is waiting for an answer.')).toBeTruthy();
    expect(state.count('GET /api/friend/requests?direction=incoming')).toBe(2);
    // The row took its own error with it, so the page says why it went, with the person's name.
    await waitFor(() => expect(newsLine()).toEqual({ text: 'Carl: Friend request not found', isLiveRegion: true }));
  });

  it('says why a request that was sent is gone, when the other person answered it while the page was open', async () => {
    const { state } = openFriends((fake) => fake.addFriendRequest({ from: john, to: dana }));
    const user = userEvent.setup();
    const sent = await section('Requests you sent');
    await sent.findByText('Dana');

    state.friendRequests.length = 0; // Dana rejected it
    await user.click(sent.getByRole('button', { name: 'Cancel request to Dana' }));

    expect(await sent.findByText('You have no requests waiting for an answer.')).toBeTruthy();
    await waitFor(() => expect(newsLine()?.text).toBe('Dana: Friend request not found'));
  });

  it('says why a request that came in is gone, when the person rejects one that was taken back', async () => {
    const { state } = openFriends((fake) => fake.addFriendRequest({ from: carl, to: john }));
    const user = userEvent.setup();
    const incoming = await section('Friend requests');
    await incoming.findByText('Carl');

    state.friendRequests.length = 0;
    await user.click(incoming.getByRole('button', { name: 'Reject Carl' }));

    expect(await incoming.findByText('No one is waiting for an answer.')).toBeTruthy();
    await waitFor(() => expect(newsLine()?.text).toBe('Carl: Friend request not found'));
  });

  it('says nothing when an action works', async () => {
    openFriends((fake) => fake.addFriendRequest({ from: carl, to: john }));
    const user = userEvent.setup();
    const incoming = await section('Friend requests');

    await user.click(await incoming.findByRole('button', { name: 'Reject Carl' }));
    await incoming.findByText('No one is waiting for an answer.');

    expect(newsLine()).toBeNull();
  });

  it('lets the person dismiss the news, and a newer piece of news takes its place', async () => {
    const { state } = openFriends((fake) => {
      fake.addFriendRequest({ from: carl, to: john });
      fake.addFriendRequest({ from: dana, to: john });
    });
    const user = userEvent.setup();
    const incoming = await section('Friend requests');
    await incoming.findByText('Dana');

    state.friendRequests.splice(0, 1); // Carl took his request back (it is the older one: Dana's is listed first)
    await user.click(incoming.getByRole('button', { name: 'Accept Carl' }));
    await waitFor(() => expect(newsLine()?.text).toBe('Carl: Friend request not found'));
    expect(incoming.queryByRole('button', { name: 'Accept Carl' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(newsLine()).toBeNull();

    // Not dismissed this time: the next piece of news replaces the one on the page.
    state.friendRequests.length = 0; // and Dana did too
    await user.click(await incoming.findByRole('button', { name: 'Accept Dana' }));
    await waitFor(() => expect(newsLine()?.text).toBe('Dana: Friend request not found'));
  });
});

describe('the friends', () => {
  it('asks before unfriending, and the question can be taken back', async () => {
    const { state } = openFriends((fake) => fake.friendIds.push(bea.id));
    const user = userEvent.setup();
    const friends = await section('Your friends');

    await user.click(await friends.findByRole('button', { name: 'Unfriend Bea' }));
    expect(friends.getByText(/Remove Bea from your friends\?/)).toBeTruthy();
    expect(friends.queryByRole('button', { name: 'Message Bea' })).toBeNull();
    await user.click(friends.getByRole('button', { name: 'Cancel' }));

    expect(friends.getByRole('button', { name: 'Message Bea' })).toBeTruthy();
    expect(state.requests.some((request) => request.startsWith('DELETE'))).toBe(false);
  });

  it('unfriends once confirmed, and a search card for them goes back to "Add friend"', async () => {
    const { state } = openFriends((fake) => fake.friendIds.push(bea.id));
    const user = userEvent.setup();
    await searchFor(user, tels.bea);
    const result = await section('Add a friend');
    await result.findByRole('button', { name: 'Message' });

    const friends = await section('Your friends');
    await user.click(await friends.findByRole('button', { name: 'Unfriend Bea' }));
    await user.click(friends.getByRole('button', { name: 'Unfriend' }));

    expect(await friends.findByText(/You have no friends yet/)).toBeTruthy();
    expect(await result.findByRole('button', { name: 'Add friend' })).toBeTruthy();
    expect(state.calls.some((call) => call.request === 'DELETE /api/friend/2')).toBe(true);
    expect(state.count('GET /api/friend')).toBe(1);
  });

  it('drops a friend who is not one any more', async () => {
    const { state } = openFriends((fake) => fake.friendIds.push(bea.id));
    const user = userEvent.setup();
    const friends = await section('Your friends');
    await user.click(await friends.findByRole('button', { name: 'Unfriend Bea' }));

    state.friendIds.length = 0; // unfriended from another device
    await user.click(friends.getByRole('button', { name: 'Unfriend' }));

    expect(await friends.findByText(/You have no friends yet/)).toBeTruthy();
    expect(state.count('GET /api/friend')).toBe(2);
    await waitFor(() => expect(newsLine()).toEqual({ text: 'Bea: You are not friends with this user', isLiveRegion: true }));
  });
});

describe('"Message"', () => {
  it('makes the direct room and opens it', async () => {
    const { state, router } = openFriends((fake) => fake.friendIds.push(bea.id));
    const user = userEvent.setup();
    const friends = await section('Your friends');

    await user.click(await friends.findByRole('button', { name: 'Message Bea' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Bea' })).toBeTruthy();
    expect(router.state.location.pathname).toBe('/chat/1');
    expect(state.calls.find((call) => call.request === 'POST /api/chat')?.body).toEqual({ type: 'direct', member_ids: [bea.id] });
    // The room is in the list beside the conversation.
    expect(within(await screen.findByRole('navigation', { name: 'Chats' })).getByRole('link', { name: /Bea/ })).toBeTruthy();
  });

  it('opens the room that already exists instead of making a second one', async () => {
    const { state, router } = openFriends((fake) => {
      fake.friendIds.push(bea.id);
      fake.addRoom({ id: 7, name: 'Bea', memberId: bea.id });
      fake.addMessage({ chatId: 7, sender: bea, content: 'See you tomorrow' });
    });
    const user = userEvent.setup();

    await user.click(await (await section('Your friends')).findByRole('button', { name: 'Message Bea' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Bea' })).toBeTruthy();
    expect(router.state.location.pathname).toBe('/chat/7');
    expect(within(await screen.findByRole('log', { name: 'Messages' })).getByText('See you tomorrow')).toBeTruthy();
    expect(state.rooms).toHaveLength(1);
  });

  it('puts the new room into a room list that was loaded before, without asking for the list again', async () => {
    const state = stubApi({ signedIn: true });
    state.friendIds.push(bea.id);
    state.addRoom({ id: 5, name: 'Carl', memberId: carl.id });
    const { router } = renderApp('/chat');
    const user = userEvent.setup();
    const sidebar = within(await screen.findByRole('navigation', { name: 'Chats' }));
    await sidebar.findByRole('link', { name: /Carl/ });

    await user.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', { name: 'Friends' }));
    await user.click(await (await section('Your friends')).findByRole('button', { name: 'Message Bea' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/chat/6'));
    const list = within(await screen.findByRole('navigation', { name: 'Chats' }));
    expect(list.getByRole('link', { name: /Bea/ })).toBeTruthy();
    expect(list.getByRole('link', { name: /Carl/ })).toBeTruthy();
    expect(state.count('GET /api/chat')).toBe(1);
  });

  it('works from the search card for a friend too', async () => {
    const { router } = openFriends((fake) => fake.friendIds.push(carl.id));
    const user = userEvent.setup();
    await searchFor(user, tels.carl);

    await user.click(await (await section('Add a friend')).findByRole('button', { name: 'Message' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/chat/1'));
  });

  it("stays on the page with the server's text when the two are not friends any more", async () => {
    const { state, router } = openFriends((fake) => fake.friendIds.push(bea.id));
    const user = userEvent.setup();
    const friends = await section('Your friends');
    await friends.findByText('Bea');

    state.friendIds.length = 0;
    await user.click(friends.getByRole('button', { name: 'Message Bea' }));

    expect((await friends.findByRole('alert')).textContent).toBe('Only your friends can be added to a chat room');
    expect(router.state.location.pathname).toBe('/friends');
  });
});

describe('the main navigation', () => {
  it('goes between the chats and the friends, and marks the page that is open', async () => {
    stubApi({ signedIn: true });
    const { router } = renderApp('/chat');
    const user = userEvent.setup();
    const nav = within(await screen.findByRole('navigation', { name: 'Main' }));

    expect(nav.getByRole('link', { name: 'Chats' }).getAttribute('aria-current')).toBe('page');
    await user.click(nav.getByRole('link', { name: 'Friends' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Friends' })).toBeTruthy();
    expect(router.state.location.pathname).toBe('/friends');
    expect(nav.getByRole('link', { name: 'Friends' }).getAttribute('aria-current')).toBe('page');
    expect(nav.getByRole('link', { name: 'Chats' }).getAttribute('aria-current')).toBeNull();
    await user.click(nav.getByRole('link', { name: 'Chats' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/chat'));
  });

  it('sends a signed-out visitor to the login page, with the way back', async () => {
    stubApi();
    const { router } = renderApp('/friends');

    await screen.findByRole('heading', { name: 'Sign in' });
    expect(router.state.location.pathname).toBe('/login');
    expect(router.state.location.search).toEqual({ redirect: '/friends' });
  });
});
