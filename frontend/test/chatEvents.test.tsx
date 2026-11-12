// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bea, carl, dana, john, stubApi, type FakeServer } from './helpers/fakeApi';
import { renderApp } from './helpers/renderApp';

// What the server's events do to the screens, through the real router, query client and components:
// the test plays the server by sending events to a FakeSocket and keeps the fake API's data in step
// with what it sends, as the real server does. Nothing here waits for a timer to ask for anything.

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
async function findMessage(text: Parameters<typeof screen.findByText>[0]) {
  return within(await screen.findByRole('log', { name: 'Messages' })).findByText(text);
}
const roomLinks = () =>
  within(screen.getByRole('navigation', { name: 'Chats' }))
    .getAllByRole('listitem')
    .map((item) => within(item).getByRole('link'));
const textOf = (element: HTMLElement) => element.textContent ?? '';
const requestsTo = (state: FakeServer, request: string) => state.count(request);
/**
 * Lets what an event started finish before a check that something did NOT happen: TanStack Query hands its
 * changes to React on a timer, so a check made at once would pass before the screen had changed.
 */
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 60)));

/** John's direct rooms with Bea (1) and Carl (2), each with one message from them, and a group (3) with Bea and Carl. */
function rooms() {
  const state = stubApi({ signedIn: true });
  state.addRoom({ id: 1, name: 'Bea' });
  state.addRoom({ id: 2, name: 'Carl' });
  state.addRoom({
    id: 3,
    type: 'group',
    name: 'Project chat',
    members: [
      { userId: john.id, role: 'admin' },
      { userId: bea.id, role: 'member' },
      { userId: carl.id, role: 'member' },
    ],
  });
  state.addMessage({ chatId: 1, sender: bea, content: 'hello from Bea', createdAt: '2026-10-20T09:00:00.000Z' });
  state.addMessage({ chatId: 2, sender: carl, content: 'hello from Carl', createdAt: '2026-10-20T08:00:00.000Z' });
  state.rooms.forEach(
    (room) => (room.lastReadMessageId = state.messages.filter((m) => m.chatId === room.id).at(-1)?.id ?? null),
  );
  return state;
}

describe('message:new', () => {
  it('shows a message that arrives in the open conversation without asking for anything, and reports it read', async () => {
    const state = rooms();
    const { socket } = renderApp('/chat/1');
    await findMessage('hello from Bea');
    const requestsSoFar = state.requests.length;

    const message = state.addMessage({ chatId: 1, sender: bea, content: 'are you there?' });
    socket.serverSends('message:new', { message });

    expect(await findMessage('are you there?')).toBeTruthy();
    await waitFor(() => expect(state.requests).toContain('PUT /api/chat/1/read'));
    expect(state.calls.find((call) => call.request === 'PUT /api/chat/1/read')?.body).toEqual({
      message_id: message.id,
    });
    expect(state.requests.slice(requestsSoFar).filter((request) => request.startsWith('GET'))).toEqual([]);
    await waitFor(() => expect(textOf(roomLinks()[0]!)).not.toContain('unread'));
    expect(textOf(roomLinks()[0]!)).toContain('are you there?');
  });

  it('puts a message of another room in that room: its preview, one more unread, and the room at the top', async () => {
    const state = rooms();
    const { socket } = renderApp('/chat/1');
    await findMessage('hello from Bea');
    expect(roomLinks().map((link) => textOf(link).includes('Bea'))[0]).toBe(true); // Bea's is the newest

    const message = state.addMessage({ chatId: 2, sender: carl, content: 'got a minute?' });
    socket.serverSends('message:new', { message });

    await waitFor(() => expect(textOf(roomLinks()[0]!)).toContain('Carl'));
    expect(textOf(roomLinks()[0]!)).toContain('got a minute?');
    expect(textOf(roomLinks()[0]!)).toContain('1 unread');
    expect(state.requests.filter((request) => request.includes('/api/chat/2'))).toEqual([]);
  });

  it('counts a message once however many times it arrives', async () => {
    const state = rooms();
    const { socket } = renderApp('/chat');
    await screen.findByRole('navigation', { name: 'Chats' });
    await waitFor(() => expect(roomLinks()).toHaveLength(3));

    const message = state.addMessage({ chatId: 2, sender: carl, content: 'twice' });
    socket.serverSends('message:new', { message });
    socket.serverSends('message:new', { message });

    await waitFor(() => expect(textOf(roomLinks()[0]!)).toContain('1 unread'));
    expect(textOf(roomLinks()[0]!)).not.toContain('2 unread');
  });

  it("does not count the person's own message, whether this tab sent it or another one did", async () => {
    const state = rooms();
    const user = userEvent.setup();
    const { socket } = renderApp('/chat/1');
    await findMessage('hello from Bea');

    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'from this tab{Enter}');
    await findMessage('from this tab');
    socket.serverSends('message:new', { message: state.messages.at(-1)! }); // the echo of the same message
    const fromOtherTab = state.addMessage({ chatId: 2, sender: john, content: 'from my phone' });
    socket.serverSends('message:new', { message: fromOtherTab });

    await waitFor(() => expect(textOf(roomLinks()[0]!)).toContain('from my phone'));
    expect(textOf(roomLinks()[0]!)).toContain('You: from my phone');
    expect(
      roomLinks()
        .map((link) => textOf(link))
        .join(' '),
    ).not.toContain('unread');
    expect(within(messageList()).getAllByText('from this tab')).toHaveLength(1);
  });

  it('asks for the room list when the message is for a room the list does not have yet', async () => {
    const state = rooms();
    const { socket } = renderApp('/chat');
    await waitFor(() => expect(roomLinks()).toHaveLength(3));

    state.addRoom({ id: 4, name: 'Dana' });
    const message = state.addMessage({ chatId: 4, sender: dana, content: 'new here' });
    socket.serverSends('message:new', { message });

    await waitFor(() => expect(roomLinks()).toHaveLength(4));
    expect(requestsTo(state, 'GET /api/chat')).toBe(2);
    expect(textOf(roomLinks()[0]!)).toContain('Dana');
  });
});

describe('message:updated and message:deleted', () => {
  it('shows an edit made elsewhere, with its label, and in the room list when it was the preview', async () => {
    const state = rooms();
    const { socket } = renderApp('/chat/1');
    await findMessage('hello from Bea');

    const edited = { ...state.messages[0]!, content: 'hello again', editedAt: '2026-10-20T09:05:00.000Z' };
    socket.serverSends('message:updated', { message: edited });

    expect(await findMessage('hello again')).toBeTruthy();
    expect(within(messageList()).getByText('edited')).toBeTruthy();
    expect(textOf(roomLinks()[0]!)).toContain('hello again');
    expect(state.requests.filter((request) => request.startsWith('GET /api/chat/1/message'))).toHaveLength(1);
  });

  it('shows a delete made elsewhere, and the room falls back to the message before it', async () => {
    const state = rooms();
    state.addMessage({ chatId: 1, sender: bea, content: 'the second one' });
    const { socket } = renderApp('/chat/1');
    await findMessage('the second one');
    const second = state.messages.at(-1)!;

    socket.serverSends('message:deleted', { chatId: 1, messageId: second.id, deletedAt: '2026-10-20T10:00:00.000Z' });

    await waitFor(() => expect(within(messageList()).getByText('Message deleted')).toBeTruthy());
    expect(within(messageList()).queryByText('the second one')).toBeNull();
    await waitFor(() => expect(textOf(roomLinks()[0]!)).toContain('hello from Bea'));
  });

  it('asks for the room list when a message is deleted in a room that has unread messages', async () => {
    const state = rooms();
    state.rooms[1]!.lastReadMessageId = null; // Carl's message is unread
    const { socket } = renderApp('/chat');
    await waitFor(() => expect(roomLinks()).toHaveLength(3));
    expect(textOf(roomLinks().find((link) => textOf(link).includes('Carl'))!)).toContain('1 unread');
    const carlsMessage = state.messages[1]!;
    state.messages.splice(1, 1); // the server no longer counts it

    socket.serverSends('message:deleted', {
      chatId: 2,
      messageId: carlsMessage.id,
      deletedAt: '2026-10-20T10:00:00.000Z',
    });

    await waitFor(() => expect(requestsTo(state, 'GET /api/chat')).toBe(2));
    await waitFor(() =>
      expect(textOf(roomLinks().find((link) => textOf(link).includes('Carl'))!)).not.toContain('unread'),
    );
  });
});

describe('message:deleted in a room with unread messages', () => {
  it('asks for the room list even when the message was not the preview: the server counts what is left', async () => {
    const state = rooms();
    state.rooms[1]!.lastReadMessageId = null;
    state.addMessage({ chatId: 2, sender: carl, content: 'the second one' }); // the preview, and unread too
    const { socket } = renderApp('/chat');
    await waitFor(() => expect(roomLinks()).toHaveLength(3));
    const carlsRoom = () => roomLinks().find((link) => textOf(link).includes('Carl'))!;
    expect(textOf(carlsRoom())).toContain('2 unread');
    const first = state.messages[1]!;
    state.messages.splice(1, 1); // the server no longer counts it

    socket.serverSends('message:deleted', { chatId: 2, messageId: first.id, deletedAt: '2026-10-20T10:00:00.000Z' });

    await waitFor(() => expect(requestsTo(state, 'GET /api/chat')).toBe(2));
    await waitFor(() => expect(textOf(carlsRoom())).toContain('1 unread'));
  });

  it('asks for it once, not twice, when the deleted message was the preview too', async () => {
    const state = rooms();
    state.rooms[1]!.lastReadMessageId = null;
    const { socket } = renderApp('/chat');
    await waitFor(() => expect(roomLinks()).toHaveLength(3));
    const only = state.messages[1]!;
    state.messages.splice(1, 1);

    socket.serverSends('message:deleted', { chatId: 2, messageId: only.id, deletedAt: '2026-10-20T10:00:00.000Z' });
    await settle();

    expect(requestsTo(state, 'GET /api/chat')).toBe(2);
  });
});

describe('rooms and members', () => {
  it("shows a group's new name in the list and above the conversation", async () => {
    rooms();
    const { socket } = renderApp('/chat/3');
    await screen.findByRole('heading', { name: 'Project chat' });

    socket.serverSends('chat:updated', { chatId: 3, name: 'Renamed chat', avatarUrl: null });

    expect(await screen.findByRole('heading', { name: 'Renamed chat' })).toBeTruthy();
    expect(textOf(roomLinks().find((link) => textOf(link).includes('Renamed chat'))!)).toContain('Renamed chat');
  });

  it('takes the room out of the list, and leaves it when it is the open one', async () => {
    rooms();
    const { socket, router } = renderApp('/chat/3');
    await screen.findByRole('heading', { name: 'Project chat' });

    socket.serverSends('chat:removed', { chatId: 3 });

    await waitFor(() => expect(router.state.location.pathname).toBe('/chat'));
    expect(
      roomLinks()
        .map((link) => textOf(link))
        .join(' '),
    ).not.toContain('Project chat');
  });

  it('takes a room out of the list without leaving the room that is open when it is another one', async () => {
    rooms();
    const { socket, router } = renderApp('/chat/1');
    await findMessage('hello from Bea');

    socket.serverSends('chat:removed', { chatId: 3 });

    await waitFor(() =>
      expect(
        roomLinks()
          .map((link) => textOf(link))
          .join(' '),
      ).not.toContain('Project chat'),
    );
    expect(router.state.location.pathname).toBe('/chat/1');
  });

  it('asks for the room list when the person is added to a room they do not have, and not when they do', async () => {
    const state = rooms();
    const { socket } = renderApp('/chat');
    await waitFor(() => expect(roomLinks()).toHaveLength(3));

    socket.serverSends('member:added', { chatId: 3, userIds: [dana.id] });
    await settle();
    expect(requestsTo(state, 'GET /api/chat')).toBe(1);

    state.addRoom({ id: 5, type: 'group', name: 'Weekend', members: [{ userId: john.id, role: 'member' }] });
    socket.serverSends('member:added', { chatId: 5, userIds: [john.id] });

    await waitFor(() => expect(roomLinks()).toHaveLength(4));
    expect(requestsTo(state, 'GET /api/chat')).toBe(2);
  });

  it.each(['member:added', 'member:removed', 'member:role_changed'] as const)(
    'asks again for the members of the open panel on %s',
    async (event) => {
      const state = rooms();
      const { socket } = renderApp('/chat/3?members=true');
      await within(await screen.findByRole('region', { name: 'Members' })).findAllByRole('listitem');
      expect(requestsTo(state, 'GET /api/chat/3/member')).toBe(1);

      if (event === 'member:added') socket.serverSends(event, { chatId: 3, userIds: [dana.id] });
      else if (event === 'member:removed') socket.serverSends(event, { chatId: 3, userId: carl.id });
      else socket.serverSends(event, { chatId: 3, userId: bea.id, role: 'admin' });

      await waitFor(() => expect(requestsTo(state, 'GET /api/chat/3/member')).toBe(2));
    },
  );

  it('does not ask for the members of a room whose panel is not open', async () => {
    const state = rooms();
    const { socket } = renderApp('/chat/3');
    await screen.findByRole('heading', { name: 'Project chat' });

    socket.serverSends('member:role_changed', { chatId: 3, userId: bea.id, role: 'admin' });
    await settle();

    expect(requestsTo(state, 'GET /api/chat/3/member')).toBe(0);
  });
});

describe('read:updated', () => {
  it("clears the unread count when the person's own marker moved past the room's last message in another tab", async () => {
    const state = rooms();
    state.rooms[1]!.lastReadMessageId = null;
    const { socket } = renderApp('/chat');
    await waitFor(() => expect(roomLinks()).toHaveLength(3));
    const carlsRoom = () => roomLinks().find((link) => textOf(link).includes('Carl'))!;
    expect(textOf(carlsRoom())).toContain('1 unread');

    socket.serverSends('read:updated', { chatId: 2, userId: john.id, lastReadMessageId: state.messages[1]!.id });

    await waitFor(() => expect(textOf(carlsRoom())).not.toContain('unread'));
    expect(requestsTo(state, 'GET /api/chat')).toBe(1);
  });

  it('asks for the room list when the marker stopped short of the last message: the server counts what is left', async () => {
    const state = rooms();
    state.rooms[1]!.lastReadMessageId = null;
    state.addMessage({ chatId: 2, sender: carl, content: 'and another' });
    const { socket } = renderApp('/chat');
    await waitFor(() => expect(roomLinks()).toHaveLength(3));

    state.rooms[1]!.lastReadMessageId = state.messages[1]!.id;
    socket.serverSends('read:updated', { chatId: 2, userId: john.id, lastReadMessageId: state.messages[1]!.id });

    await waitFor(() => expect(requestsTo(state, 'GET /api/chat')).toBe(2));
    await waitFor(() =>
      expect(textOf(roomLinks().find((link) => textOf(link).includes('Carl'))!)).toContain('1 unread'),
    );
  });

  it("keeps somebody else's marker out of the unread count, and asks for nothing", async () => {
    const state = rooms();
    state.rooms[1]!.lastReadMessageId = null;
    const { socket } = renderApp('/chat');
    await waitFor(() => expect(roomLinks()).toHaveLength(3));
    const requestsSoFar = state.requests.length;

    socket.serverSends('read:updated', { chatId: 2, userId: carl.id, lastReadMessageId: state.messages[1]!.id });
    await settle();

    expect(textOf(roomLinks().find((link) => textOf(link).includes('Carl'))!)).toContain('1 unread');
    expect(state.requests).toHaveLength(requestsSoFar);
  });
});

describe('typing', () => {
  const typingLine = () => screen.getByRole('status', { name: '' });

  it('shows who is typing, and stops after a few seconds of silence', async () => {
    rooms();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { socket } = renderApp('/chat/3');
    await screen.findByRole('heading', { name: 'Project chat' });

    socket.serverSends('typing', { chatId: 3, user: { id: bea.id, name: 'Bea', avatarUrl: null } });
    expect(await screen.findByText('Bea is typing…')).toBeTruthy();
    await act(() => vi.advanceTimersByTimeAsync(3_000));
    socket.serverSends('typing', { chatId: 3, user: { id: bea.id, name: 'Bea', avatarUrl: null } }); // she is still at it
    await act(() => vi.advanceTimersByTimeAsync(3_000));
    expect(screen.queryByText('Bea is typing…')).not.toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(2_000));

    expect(screen.queryByText('Bea is typing…')).toBeNull();
  });

  it('names two people, and says several for more', async () => {
    rooms();
    const { socket } = renderApp('/chat/3');
    await screen.findByRole('heading', { name: 'Project chat' });

    socket.serverSends('typing', { chatId: 3, user: { id: bea.id, name: 'Bea', avatarUrl: null } });
    socket.serverSends('typing', { chatId: 3, user: { id: carl.id, name: 'Carl', avatarUrl: null } });
    expect(await screen.findByText('Bea and Carl are typing…')).toBeTruthy();
    socket.serverSends('typing', { chatId: 3, user: { id: dana.id, name: 'Dana', avatarUrl: null } });

    expect(await screen.findByText('Several people are typing…')).toBeTruthy();
  });

  it("ends a person's typing when their message arrives, and ignores other rooms and the person's own typing", async () => {
    const state = rooms();
    const { socket } = renderApp('/chat/3');
    await screen.findByRole('heading', { name: 'Project chat' });

    socket.serverSends('typing', { chatId: 1, user: { id: bea.id, name: 'Bea', avatarUrl: null } });
    socket.serverSends('typing', { chatId: 3, user: { id: john.id, name: 'John', avatarUrl: null } });
    await settle();
    expect(screen.queryByText(/typing/)).toBeNull();

    socket.serverSends('typing', { chatId: 3, user: { id: bea.id, name: 'Bea', avatarUrl: null } });
    expect(await screen.findByText('Bea is typing…')).toBeTruthy();
    const message = state.addMessage({ chatId: 3, sender: bea, content: 'done typing' });
    socket.serverSends('message:new', { message });

    await waitFor(() => expect(screen.queryByText('Bea is typing…')).toBeNull());
  });

  it('forgets who was typing when the person goes to another room', async () => {
    rooms();
    const user = userEvent.setup();
    const { socket } = renderApp('/chat/3');
    await screen.findByRole('heading', { name: 'Project chat' });
    socket.serverSends('typing', { chatId: 3, user: { id: bea.id, name: 'Bea', avatarUrl: null } });
    await screen.findByText('Bea is typing…');

    await user.click(within(screen.getByRole('navigation', { name: 'Chats' })).getByRole('link', { name: /Carl/ }));
    await screen.findByRole('heading', { name: 'Carl' });
    await user.click(
      within(screen.getByRole('navigation', { name: 'Chats' })).getByRole('link', { name: /Project chat/ }),
    );

    await screen.findByRole('heading', { name: 'Project chat' });
    expect(screen.queryByText('Bea is typing…')).toBeNull();
  });

  it('tells the server the person is typing, at most every couple of seconds, and only with something in the box', async () => {
    rooms();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { socket } = renderApp('/chat/3');
    await screen.findByRole('heading', { name: 'Project chat' });
    const box = screen.getByRole('textbox', { name: 'Message' });

    fireEvent.change(box, { target: { value: '   ' } });
    expect(socket.sentPayloads('typing')).toEqual([]);
    fireEvent.change(box, { target: { value: 'h' } });
    fireEvent.change(box, { target: { value: 'he' } });
    fireEvent.change(box, { target: { value: 'hey' } });
    expect(socket.sentPayloads('typing')).toEqual([{ chatId: 3 }]);
    await act(() => vi.advanceTimersByTimeAsync(2_100));
    fireEvent.change(box, { target: { value: 'hey!' } });

    expect(socket.sentPayloads('typing')).toEqual([{ chatId: 3 }, { chatId: 3 }]);
  });

  it('says nothing while the socket is down: a typing sent late would be long over', async () => {
    rooms();
    const { socket } = renderApp('/chat/3');
    await screen.findByRole('heading', { name: 'Project chat' });
    socket.dropConnection();

    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'hey' } });

    expect(socket.sentPayloads('typing')).toEqual([]);
  });

  it('has its line in the page from the start, empty, so that a screen reader announces what is put into it', async () => {
    rooms();
    renderApp('/chat/3');
    await screen.findByRole('heading', { name: 'Project chat' });

    expect(typingLine().textContent).toBe('');
  });
});
