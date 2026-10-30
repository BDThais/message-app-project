// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POLL_INTERVAL_MS } from '@/features/chats/queries';
import { bea, carl, john, stubApi, type FakeServer } from './helpers/fakeApi';
import { renderApp } from './helpers/renderApp';

// The chat screens through the real router, query client and components, against the fake API: the
// room list, a conversation, sending, editing, deleting, older messages and the read marker.

beforeEach(() => {
  window.scrollTo = vi.fn(); // jsdom has none, and the router scrolls to the top on navigation
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const messageList = () => screen.getByRole('log', { name: 'Messages' });
/** Waits for the page to be there, then for a message with this text *in the conversation* (the room list shows the same text as a preview). */
async function findMessage(text: Parameters<typeof screen.findByText>[0]) {
  return within(await screen.findByRole('log', { name: 'Messages' })).findByText(text);
}
const messageNamed = (text: string) => within(messageList()).getByText(text).closest('li') as HTMLElement;
const textOf = (element: HTMLElement) => element.textContent ?? '';

/** John's direct room with Bea (id 1) holding the given messages. */
function roomWithBea(...messages: Array<{ from: 'john' | 'bea'; content: string }>): FakeServer {
  const state = stubApi({ signedIn: true });
  state.addRoom({ id: 1, name: 'Bea' });
  for (const { from, content } of messages) {
    state.addMessage({ chatId: 1, sender: from === 'john' ? john : bea, content });
  }
  return state;
}

describe('the room list', () => {
  it('shows every room, newest message first, with its preview and unread count', async () => {
    const state = stubApi({ signedIn: true });
    state.addRoom({ id: 1, name: 'Bea' });
    state.addRoom({ id: 2, name: 'Project chat', type: 'group' });
    state.addMessage({ chatId: 1, sender: bea, content: 'See you tomorrow', createdAt: '2026-10-20T09:00:00.000Z' });
    state.addMessage({ chatId: 2, sender: carl, content: 'Deploy is done', createdAt: '2026-10-21T09:00:00.000Z' });
    state.addMessage({ chatId: 2, sender: carl, content: 'Who reviews?', createdAt: '2026-10-21T09:05:00.000Z' });
    renderApp('/chat');

    const links = await within(await screen.findByRole('navigation', { name: 'Chats' })).findAllByRole('link');

    expect(links).toHaveLength(2);
    expect(textOf(links[0]!)).toContain('Project chat');
    expect(textOf(links[0]!)).toContain('Who reviews?');
    expect(textOf(links[0]!)).toContain('2 unread');
    expect(textOf(links[1]!)).toContain('Bea');
    expect(textOf(links[1]!)).toContain('See you tomorrow');
    expect(textOf(links[1]!)).toContain('1 unread');
  });

  it('marks a preview that the person wrote with "You:", and one that somebody else wrote not', async () => {
    const state = stubApi({ signedIn: true });
    state.addRoom({ id: 1, name: 'Bea' });
    state.addRoom({ id: 2, name: 'Carl' });
    state.addMessage({ chatId: 1, sender: john, content: 'on my way', createdAt: '2026-10-20T09:00:00.000Z' });
    state.addMessage({ chatId: 2, sender: carl, content: 'see you', createdAt: '2026-10-21T09:00:00.000Z' });
    state.addMessage({ chatId: 2, sender: null, content: 'from nobody', createdAt: '2026-10-21T09:05:00.000Z' });
    renderApp('/chat');

    const withBea = await screen.findByRole('link', { name: /Bea/ });
    const withCarl = await screen.findByRole('link', { name: /Carl/ });

    expect(textOf(withBea)).toContain('You: on my way');
    expect(textOf(withCarl)).toContain('from nobody');
    expect(textOf(withCarl)).not.toContain('You:');
  });

  it('says so when there are no rooms, and when a room has no messages', async () => {
    const state = stubApi({ signedIn: true });
    renderApp('/chat');
    expect(await screen.findByText('You have no chats yet.')).toBeTruthy();

    cleanup();
    state.addRoom({ id: 1, name: 'Bea' });
    renderApp('/chat');
    expect(await screen.findByText('No messages yet')).toBeTruthy();
  });

  it('names a room whose other member is gone, and a group without a name', async () => {
    const state = stubApi({ signedIn: true });
    state.addRoom({ id: 1, name: null });
    state.addRoom({ id: 2, name: null, type: 'group' });
    renderApp('/chat');

    expect(await screen.findByText('Deleted user')).toBeTruthy();
    expect(screen.getByText('Group chat')).toBeTruthy();
  });

  it('stays mounted when the person goes from one room to another', async () => {
    const state = stubApi({ signedIn: true });
    state.addRoom({ id: 1, name: 'Bea' });
    state.addRoom({ id: 2, name: 'Carl' });
    state.addMessage({ chatId: 1, sender: bea, content: 'from Bea' });
    state.addMessage({ chatId: 2, sender: carl, content: 'from Carl' });
    const user = userEvent.setup();
    const { router } = renderApp('/chat');

    const nav = await screen.findByRole('navigation', { name: 'Chats' });
    await user.click(await within(nav).findByRole('link', { name: /Bea/ }));
    expect(await findMessage('from Bea')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Bea' })).toBeTruthy();
    expect(within(nav).getByRole('link', { name: /Bea/ }).getAttribute('aria-current')).toBe('page');

    await user.click(within(nav).getByRole('link', { name: /Carl/ }));
    expect(await findMessage('from Carl')).toBeTruthy();
    expect(router.state.location.pathname).toBe('/chat/2');
    expect(screen.getByRole('navigation', { name: 'Chats' })).toBe(nav); // the very same element, not a new one
  });

  it('shows a new message in another room without opening it', async () => {
    const state = stubApi({ signedIn: true });
    state.addRoom({ id: 1, name: 'Bea' });
    state.addRoom({ id: 2, name: 'Carl' });
    const { queryClient } = renderApp('/chat/1');
    await screen.findByText('No messages yet. Say hello!');

    state.addMessage({ chatId: 2, sender: carl, content: 'Are you there?' });
    await queryClient.invalidateQueries({ queryKey: ['chats', 'list'] });

    const link = await screen.findByRole('link', { name: /Carl/ });
    expect(textOf(link)).toContain('Are you there?');
    expect(textOf(link)).toContain('1 unread');
  });
});

describe('a conversation', () => {
  it('shows the messages oldest first, with actions only on the person\'s own', async () => {
    roomWithBea({ from: 'bea', content: 'first' }, { from: 'john', content: 'second' }, { from: 'bea', content: 'third' });
    renderApp('/chat/1');

    await findMessage('third');
    const items = within(messageList()).getAllByRole('listitem');
    expect(items.map(textOf).map((text) => ['first', 'second', 'third'].find((word) => text.includes(word)))).toEqual([
      'first',
      'second',
      'third',
    ]);
    expect(within(items[0]!).queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(within(items[1]!).getByRole('button', { name: 'Edit' })).toBeTruthy();
    expect(within(items[1]!).getByRole('button', { name: 'Delete' })).toBeTruthy();
    expect(within(items[2]!).queryByRole('button', { name: 'Delete' })).toBeNull();
  });

  it('names the sender in a group, and gives a deleted account\'s messages a placeholder and no actions', async () => {
    const state = stubApi({ signedIn: true });
    state.addRoom({ id: 1, name: 'Project chat', type: 'group' });
    state.addMessage({ chatId: 1, sender: carl, content: 'from Carl' });
    state.addMessage({ chatId: 1, sender: null, content: 'from nobody' });
    renderApp('/chat/1');

    await findMessage('from nobody');
    expect(textOf(messageNamed('from Carl'))).toContain('Carl');
    expect(textOf(messageNamed('from nobody'))).toContain('Deleted user');
    expect(within(messageNamed('from nobody')).queryByRole('button')).toBeNull();
  });

  it('does not name the sender in a direct room', async () => {
    roomWithBea({ from: 'bea', content: 'hello' });
    renderApp('/chat/1');

    await findMessage('hello');
    expect(textOf(messageNamed('hello'))).not.toContain('Bea');
  });

  it('shows "message deleted" for a deleted message and "edited" for an edited one', async () => {
    const state = roomWithBea({ from: 'bea', content: 'gone' }, { from: 'bea', content: 'changed' });
    state.messages[0]!.content = '';
    state.messages[0]!.deletedAt = '2026-10-20T10:00:00.000Z';
    state.messages[1]!.editedAt = '2026-10-20T10:00:00.000Z';
    renderApp('/chat/1');

    expect(await findMessage('Message deleted')).toBeTruthy();
    expect(textOf(messageNamed('changed'))).toContain('edited');
  });

  it.each(['/chat/99', '/chat/not-a-number', '/chat/0', '/chat/2147483648'])(
    'says that %s is not there, and asks for no messages when the id cannot be one',
    async (path) => {
      const state = roomWithBea({ from: 'bea', content: 'hello' });
      renderApp(path);

      expect(await screen.findByRole('heading', { name: 'Chat not found' })).toBeTruthy();
      expect(screen.getAllByRole('main')).toHaveLength(1);
      if (path !== '/chat/99') {
        expect(state.requests.filter((request) => request.includes('/message'))).toEqual([]);
      }
    },
  );

  it('asks the server for new messages every few seconds', async () => {
    const state = roomWithBea({ from: 'bea', content: 'first' });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderApp('/chat/1');
    await findMessage('first');

    state.addMessage({ chatId: 1, sender: bea, content: 'a little later' });
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS + 100);

    expect(await findMessage('a little later')).toBeTruthy();
  });
});

describe('sending', () => {
  it('shows the message from the answer, empties the box, and moves the room to the top, without a refetch', async () => {
    const state = stubApi({ signedIn: true });
    state.addRoom({ id: 1, name: 'Bea' });
    state.addRoom({ id: 2, name: 'Carl' });
    state.addMessage({ chatId: 2, sender: carl, content: 'newer than the empty room' });
    const user = userEvent.setup();
    renderApp('/chat/1');
    const nav = await screen.findByRole('navigation', { name: 'Chats' });
    await screen.findByText('No messages yet. Say hello!');
    expect(within(nav).getAllByRole('link').map((link) => textOf(link).includes('Carl'))).toEqual([true, false]);

    const box = screen.getByRole('textbox', { name: 'Message' });
    await user.type(box, '  Hello there  ');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(await findMessage('Hello there')).toBeTruthy();
    expect((box as HTMLTextAreaElement).value).toBe('');
    expect(state.count('POST /api/chat/1/message')).toBe(1);
    expect(state.count('GET /api/chat/1/message')).toBe(1);
    expect(within(nav).getAllByRole('link').map((link) => textOf(link).includes('Bea'))).toEqual([true, false]);
    expect(textOf(within(nav).getAllByRole('link')[0]!)).toContain('Hello there');
  });

  it('sends on Enter and writes a new line on Shift+Enter', async () => {
    const state = roomWithBea({ from: 'bea', content: 'hi' });
    const user = userEvent.setup();
    renderApp('/chat/1');
    await findMessage('hi');

    const box = screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement;
    await user.type(box, 'one{Shift>}{Enter}{/Shift}two');
    expect(box.value).toBe('one\ntwo');
    expect(state.count('POST /api/chat/1/message')).toBe(0);

    await user.type(box, '{Enter}');
    await findMessage((_, element) => element?.tagName === 'P' && element.textContent === 'one\ntwo');
    expect(state.count('POST /api/chat/1/message')).toBe(1);
  });

  it('does not send a blank message', async () => {
    const state = roomWithBea({ from: 'bea', content: 'hi' });
    const user = userEvent.setup();
    renderApp('/chat/1');
    await findMessage('hi');

    await user.type(screen.getByRole('textbox', { name: 'Message' }), '   {Enter}');

    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true);
    expect(state.count('POST /api/chat/1/message')).toBe(0);
  });

  it('shows the server\'s answer when it refuses, and keeps what was typed', async () => {
    const state = roomWithBea({ from: 'bea', content: 'hi' });
    state.messageWriteError = 'content must be 4000 characters or fewer';
    const user = userEvent.setup();
    renderApp('/chat/1');
    await findMessage('hi');

    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'my text');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect((await screen.findByRole('alert')).textContent).toBe('content must be 4000 characters or fewer');
    expect((screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement).value).toBe('my text');
  });
});

describe('editing and deleting', () => {
  it('puts the edited message from the answer into the list, marks it edited, and changes the room preview without asking for anything', async () => {
    const state = roomWithBea({ from: 'bea', content: 'hi' }, { from: 'john', content: 'helo' });
    const user = userEvent.setup();
    renderApp('/chat/1');
    await findMessage('helo');

    await user.click(within(messageNamed('helo')).getByRole('button', { name: 'Edit' }));
    const box = screen.getByRole('textbox', { name: 'Edit message' }) as HTMLTextAreaElement;
    expect(box.value).toBe('helo');
    await user.clear(box);
    await user.type(box, 'hello');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await findMessage('hello')).toBeTruthy();
    expect(textOf(messageNamed('hello'))).toContain('edited');
    expect(screen.queryByRole('textbox', { name: 'Edit message' })).toBeNull();
    expect(state.count('GET /api/chat/1/message')).toBe(1);
    const link = screen.getByRole('link', { name: /Bea/ });
    expect(textOf(link)).toContain('You: hello'); // the edited message is the room's last one, and its id says so
    expect(state.count('GET /api/chat')).toBe(1);
  });

  it('leaves the room preview alone when the edited message is not the last one', async () => {
    const state = roomWithBea({ from: 'john', content: 'first' }, { from: 'bea', content: 'second' });
    const user = userEvent.setup();
    renderApp('/chat/1');
    await findMessage('first');

    await user.click(within(messageNamed('first')).getByRole('button', { name: 'Edit' }));
    await user.type(screen.getByRole('textbox', { name: 'Edit message' }), ' (fixed){Enter}');

    expect(await findMessage('first (fixed)')).toBeTruthy();
    const link = screen.getByRole('link', { name: /Bea/ });
    expect(textOf(link)).toContain('second');
    expect(textOf(link)).not.toContain('fixed');
    expect(state.count('GET /api/chat')).toBe(1);
  });

  it('leaves an edit with Escape or Cancel, without a request', async () => {
    const state = roomWithBea({ from: 'john', content: 'keep me' });
    const user = userEvent.setup();
    renderApp('/chat/1');
    await findMessage('keep me');

    await user.click(within(messageNamed('keep me')).getByRole('button', { name: 'Edit' }));
    await user.type(screen.getByRole('textbox', { name: 'Edit message' }), ' changed{Escape}');
    expect(screen.queryByRole('textbox', { name: 'Edit message' })).toBeNull();
    expect(messageNamed('keep me')).toBeTruthy();

    await user.click(within(messageNamed('keep me')).getByRole('button', { name: 'Edit' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('textbox', { name: 'Edit message' })).toBeNull();
    expect(state.count('PATCH /api/chat/1/message/1')).toBe(0);
  });

  it('shows the server\'s answer when an edit is refused, and keeps the box open', async () => {
    const state = roomWithBea({ from: 'john', content: 'mine' });
    state.messageWriteError = 'content must be a non-empty string';
    const user = userEvent.setup();
    renderApp('/chat/1');
    await findMessage('mine');

    await user.click(within(messageNamed('mine')).getByRole('button', { name: 'Edit' }));
    await user.type(screen.getByRole('textbox', { name: 'Edit message' }), '!{Enter}');

    expect((await screen.findByRole('alert')).textContent).toBe('content must be a non-empty string');
    expect(screen.getByRole('textbox', { name: 'Edit message' })).toBeTruthy();
  });

  it('asks before deleting, then shows a placeholder from the answer and refreshes the room preview', async () => {
    const state = roomWithBea({ from: 'bea', content: 'Earlier' }, { from: 'john', content: 'Oops' });
    const user = userEvent.setup();
    renderApp('/chat/1');
    const nav = await screen.findByRole('navigation', { name: 'Chats' });
    await findMessage('Oops');
    expect(textOf(await within(nav).findByRole('link', { name: /Bea/ }))).toContain('Oops');

    await user.click(within(messageNamed('Oops')).getByRole('button', { name: 'Delete' }));
    expect(state.count('DELETE /api/chat/1/message/2')).toBe(0);
    await user.click(within(screen.getByRole('group', { name: 'Confirm delete' })).getByRole('button', { name: 'Delete' }));

    expect(await findMessage('Message deleted')).toBeTruthy();
    expect(within(messageList()).queryByText('Oops')).toBeNull();
    expect(state.count('GET /api/chat/1/message')).toBe(1);
    // The preview falls back to the message before it, which the conversation already holds.
    const link = within(nav).getByRole('link', { name: /Bea/ });
    expect(textOf(link)).toContain('Earlier');
    expect(textOf(link)).not.toContain('You:');
    expect(state.count('GET /api/chat')).toBe(1);
  });

  it('leaves the room preview alone, and asks for nothing, when a message that is not the last one is deleted', async () => {
    const state = roomWithBea({ from: 'john', content: 'mine' }, { from: 'bea', content: 'last word' });
    const user = userEvent.setup();
    renderApp('/chat/1');
    await findMessage('mine');

    await user.click(within(messageNamed('mine')).getByRole('button', { name: 'Delete' }));
    await user.click(within(screen.getByRole('group', { name: 'Confirm delete' })).getByRole('button', { name: 'Delete' }));

    expect(await findMessage('Message deleted')).toBeTruthy();
    expect(textOf(screen.getByRole('link', { name: /Bea/ }))).toContain('last word');
    expect(state.count('GET /api/chat')).toBe(1);
  });

  it('asks for the room list when the conversation cannot tell what the preview falls back to', async () => {
    const state = stubApi({ signedIn: true });
    state.addRoom({ id: 1, name: 'Bea' });
    for (let number = 1; number <= 60; number += 1) {
      state.addMessage({ chatId: 1, sender: number === 60 ? john : bea, content: `message ${number}` });
    }
    // The newest page (11 to 60) is all deleted but the last message, and ten older ones are not loaded.
    for (const message of state.messages.slice(10, 59)) message.deletedAt = '2026-10-20T10:00:00.000Z';
    const user = userEvent.setup();
    renderApp('/chat/1');
    await findMessage('message 60');

    await user.click(within(messageNamed('message 60')).getByRole('button', { name: 'Delete' }));
    await user.click(within(screen.getByRole('group', { name: 'Confirm delete' })).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(state.count('GET /api/chat')).toBe(2));
    await waitFor(() => expect(textOf(screen.getByRole('link', { name: /Bea/ }))).toContain('message 10'));
  });

  it('does not delete when the person cancels', async () => {
    const state = roomWithBea({ from: 'john', content: 'stay' });
    const user = userEvent.setup();
    renderApp('/chat/1');
    await findMessage('stay');

    await user.click(within(messageNamed('stay')).getByRole('button', { name: 'Delete' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('group', { name: 'Confirm delete' })).toBeNull();
    expect(state.count('DELETE /api/chat/1/message/1')).toBe(0);
  });
});

describe('older messages', () => {
  function roomWithMessagesFromBea(count: number) {
    const state = stubApi({ signedIn: true });
    state.addRoom({ id: 1, name: 'Bea' });
    for (let number = 1; number <= count; number += 1) {
      state.addMessage({ chatId: 1, sender: bea, content: `message ${number}` });
    }
    return state;
  }
  const roomWithSixtyMessages = () => roomWithMessagesFromBea(60);

  it('loads the next page below the oldest message shown, and shows it above, in order', async () => {
    const state = roomWithSixtyMessages();
    const user = userEvent.setup();
    renderApp('/chat/1');

    await findMessage('message 60');
    expect(within(messageList()).getAllByRole('listitem')).toHaveLength(50);
    expect(within(messageList()).queryByText('message 10')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Load earlier messages' }));

    await findMessage('message 10');
    expect(state.requests).toContain('GET /api/chat/1/message?before=11');
    const shown = within(messageList()).getAllByRole('listitem').map((item) => textOf(item).match(/message \d+/)?.[0]);
    expect(shown).toEqual(Array.from({ length: 60 }, (_, index) => `message ${index + 1}`));
    expect(screen.queryByRole('button', { name: 'Load earlier messages' })).toBeNull();
  });

  it('asks again for the newest page only, so that new messages do not slide the loaded ones out from above', async () => {
    const state = roomWithMessagesFromBea(110); // two full pages once the older one is loaded
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderApp('/chat/1');
    await findMessage('message 110');
    fireEvent.click(screen.getByRole('button', { name: 'Load earlier messages' }));
    await findMessage('message 11');

    state.addMessage({ chatId: 1, sender: bea, content: 'message 111' });
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS + 100);

    await findMessage('message 111');
    await vi.advanceTimersByTimeAsync(1_000); // time for a refetch of the older page to finish, if there were one
    expect(within(messageList()).getByText('message 11')).toBeTruthy(); // refetching both pages would have dropped it
    expect(state.requests.filter((request) => request.includes('before='))).toEqual(['GET /api/chat/1/message?before=61']);
  });

  it('offers nothing to load when the whole conversation fits in one page', async () => {
    roomWithBea({ from: 'bea', content: 'only one' });
    renderApp('/chat/1');

    await findMessage('only one');
    expect(screen.queryByRole('button', { name: 'Load earlier messages' })).toBeNull();
  });

  it('shows the error when older messages cannot be loaded, and the conversation stays', async () => {
    roomWithSixtyMessages();
    const user = userEvent.setup();
    renderApp('/chat/1');
    await findMessage('message 60');
    const realFetch = fetch as unknown as (url: string, init?: RequestInit) => Promise<Response>;
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) =>
      // A 4xx: a 5xx would be retried twice with a pause, and the test would wait for that.
      url.includes('before=')
        ? Promise.resolve(new Response(JSON.stringify({ error: 'Too many requests, try again later' }), { status: 429 }))
        : realFetch(url, init),
    );

    await user.click(screen.getByRole('button', { name: 'Load earlier messages' }));

    expect((await screen.findByRole('alert')).textContent).toBe('Too many requests, try again later');
    expect(within(messageList()).getByText('message 60')).toBeTruthy();
  });
});

describe('the read marker', () => {
  it('marks the room read up to its newest message when it is opened, and clears the unread count', async () => {
    const state = roomWithBea({ from: 'bea', content: 'one' }, { from: 'bea', content: 'two' });
    renderApp('/chat/1');

    await waitFor(() => expect(state.count('PUT /api/chat/1/read')).toBe(1));
    expect(state.calls.find(({ request }) => request === 'PUT /api/chat/1/read')?.body).toEqual({ message_id: 2 });
    const link = await screen.findByRole('link', { name: /Bea/ });
    await waitFor(() => expect(textOf(link)).not.toContain('unread'));
    expect(state.rooms[0]?.lastReadMessageId).toBe(2);
  });

  it('asks nothing when there is nothing unread', async () => {
    const state = roomWithBea({ from: 'bea', content: 'one' }, { from: 'john', content: 'two' });
    state.rooms[0]!.lastReadMessageId = 1;
    renderApp('/chat/1');

    await findMessage('two');
    expect(state.count('PUT /api/chat/1/read')).toBe(0);
  });

  it('marks a new message read when it arrives while the room is open and scrolled to the bottom', async () => {
    const state = roomWithBea({ from: 'john', content: 'one' });
    const { queryClient } = renderApp('/chat/1');
    await findMessage('one');

    state.addMessage({ chatId: 1, sender: bea, content: 'two' });
    await queryClient.invalidateQueries({ queryKey: ['chats'] });

    await waitFor(() => expect(state.count('PUT /api/chat/1/read')).toBe(1));
    expect(state.calls.find(({ request }) => request === 'PUT /api/chat/1/read')?.body).toEqual({ message_id: 2 });
  });

  it('waits until the tab is in front', async () => {
    const state = roomWithBea({ from: 'bea', content: 'one' });
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    renderApp('/chat/1');
    await findMessage('one');
    expect(state.count('PUT /api/chat/1/read')).toBe(0);

    visibility.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));

    await waitFor(() => expect(state.count('PUT /api/chat/1/read')).toBe(1));
  });

  it('waits until the person has scrolled down to the newest message', async () => {
    stubScrollLayout();
    const state = stubApi({ signedIn: true });
    state.addRoom({ id: 1, name: 'Bea' });
    for (let number = 1; number <= 10; number += 1) state.addMessage({ chatId: 1, sender: john, content: `mine ${number}` });
    const { queryClient } = renderApp('/chat/1');
    const log = await screen.findByRole('log', { name: 'Messages' });
    await within(log).findByText('mine 10');

    log.scrollTop = 0; // reading higher up: 10 messages of 50px in a window of 400px
    fireEvent.scroll(log);
    state.addMessage({ chatId: 1, sender: bea, content: 'new one' });
    await queryClient.invalidateQueries({ queryKey: ['chats'] });
    await within(log).findByText('new one');
    expect(state.count('PUT /api/chat/1/read')).toBe(0);

    log.scrollTop = 150; // the bottom of 11 messages
    fireEvent.scroll(log);

    await waitFor(() => expect(state.count('PUT /api/chat/1/read')).toBe(1));
    expect(state.calls.find(({ request }) => request === 'PUT /api/chat/1/read')?.body).toEqual({ message_id: 11 });
  });
});

// jsdom has no layout, so these give the message list one: 50px a message in a window of 400px, and a
// scroll position that can be set. What the real browser does with it is looked at in a real browser
// (see "Looking at the frontend in a real browser" in CLAUDE_SANDBOX_NOTES.md); this checks the arithmetic.
const MESSAGE_HEIGHT = 50;
const WINDOW_HEIGHT = 400;

function stubScrollLayout() {
  const tops = new WeakMap<Element, number>();
  const isMessageList = (element: Element) => element.getAttribute('role') === 'log';
  Object.defineProperties(HTMLElement.prototype, {
    scrollTop: {
      configurable: true,
      get(this: HTMLElement) {
        return tops.get(this) ?? 0;
      },
      set(this: HTMLElement, value: number) {
        tops.set(this, value);
      },
    },
    scrollHeight: {
      configurable: true,
      get(this: HTMLElement) {
        return isMessageList(this) ? this.querySelectorAll('li').length * MESSAGE_HEIGHT : 0;
      },
    },
    clientHeight: {
      configurable: true,
      get(this: HTMLElement) {
        return isMessageList(this) ? WINDOW_HEIGHT : 0;
      },
    },
  });
}

describe('scrolling', () => {
  beforeEach(stubScrollLayout);
  afterEach(() => {
    for (const name of ['scrollTop', 'scrollHeight', 'clientHeight']) {
      Reflect.deleteProperty(HTMLElement.prototype, name);
    }
  });

  function roomWithMessages(count: number, from: 'bea' | 'john' = 'bea') {
    const state = stubApi({ signedIn: true });
    state.addRoom({ id: 1, name: 'Bea' });
    for (let number = 1; number <= count; number += 1) {
      state.addMessage({ chatId: 1, sender: from === 'bea' ? bea : john, content: `message ${number}` });
    }
    return state;
  }

  it('opens at the newest message', async () => {
    roomWithMessages(60);
    renderApp('/chat/1');

    const log = await screen.findByRole('log', { name: 'Messages' });
    await within(log).findByText('message 60');

    expect(log.scrollTop).toBe(50 * MESSAGE_HEIGHT);
  });

  it('keeps the same messages on screen when older ones are added above them', async () => {
    const state = roomWithMessages(60);
    renderApp('/chat/1');
    const log = await screen.findByRole('log', { name: 'Messages' });
    await within(log).findByText('message 60');

    log.scrollTop = 0; // the person scrolled to the top
    fireEvent.scroll(log); // which asks for the next page by itself
    await within(log).findByText('message 10');

    expect(state.requests).toContain('GET /api/chat/1/message?before=11');
    expect(log.scrollTop).toBe(10 * MESSAGE_HEIGHT); // ten messages were added above: the old top is 500px lower
  });

  it('follows new messages while the person is at the bottom', async () => {
    const state = roomWithMessages(5);
    const { queryClient } = renderApp('/chat/1');
    const log = await screen.findByRole('log', { name: 'Messages' });
    await within(log).findByText('message 5');

    state.addMessage({ chatId: 1, sender: bea, content: 'message 6' });
    await queryClient.invalidateQueries({ queryKey: ['chats'] });
    await within(log).findByText('message 6');

    expect(log.scrollTop).toBe(6 * MESSAGE_HEIGHT);
  });

  it('does not pull the person down when a message arrives while they read higher up', async () => {
    const state = roomWithMessages(20);
    const { queryClient } = renderApp('/chat/1');
    const log = await screen.findByRole('log', { name: 'Messages' });
    await within(log).findByText('message 20');

    log.scrollTop = 200;
    fireEvent.scroll(log);
    state.addMessage({ chatId: 1, sender: bea, content: 'message 21' });
    await queryClient.invalidateQueries({ queryKey: ['chats'] });
    await within(log).findByText('message 21');

    expect(log.scrollTop).toBe(200);
  });

  it('takes the person to the bottom when they send a message, wherever they were', async () => {
    roomWithMessages(20);
    const user = userEvent.setup();
    renderApp('/chat/1');
    const log = await screen.findByRole('log', { name: 'Messages' });
    await within(log).findByText('message 20');
    log.scrollTop = 200;
    fireEvent.scroll(log);

    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'on my way{Enter}');
    await within(log).findByText('on my way');

    expect(log.scrollTop).toBe(21 * MESSAGE_HEIGHT);
  });
});
