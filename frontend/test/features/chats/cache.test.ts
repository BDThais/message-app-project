import { QueryClient, type InfiniteData } from '@tanstack/react-query';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  addMessageToCache,
  markMessageDeletedInCache,
  markRoomReadInCache,
  mergeNewestPageIntoCache,
  replaceMessageInCache,
  sortRooms,
} from '@/features/chats/cache';
import { chatKeys } from '@/features/chats/keys';
import type { ChatRoomSummary, Message, MessageListResponse } from '@/features/chats/types';

function message(id: number, overrides: Partial<Message> = {}): Message {
  return {
    id,
    chatId: 1,
    senderId: 2,
    content: `message ${id}`,
    createdAt: `2026-10-20T09:00:${String(id).padStart(2, '0')}.000Z`,
    editedAt: null,
    deletedAt: null,
    sender: { id: 2, name: 'Bea', avatarUrl: null },
    ...overrides,
  };
}

function room(id: number, overrides: Partial<ChatRoomSummary> = {}): ChatRoomSummary {
  return {
    id,
    type: 'direct',
    name: `Room ${id}`,
    avatarUrl: null,
    createdAt: '2026-10-01T09:00:00.000Z',
    lastMessage: null,
    unreadCount: 0,
    ...overrides,
  };
}

/** Two pages as the server sends them: newest first, so page 0 holds 5, 4 and page 1 holds 3, 2, 1. */
function twoPages(): InfiniteData<MessageListResponse, number | undefined> {
  return {
    pages: [
      { messages: [message(5), message(4)], hasMore: true },
      { messages: [message(3), message(2), message(1)], hasMore: false },
    ],
    pageParams: [undefined, 4],
  };
}

const idsOf = (queryClient: QueryClient) =>
  queryClient
    .getQueryData<InfiniteData<MessageListResponse>>(chatKeys.messages(1))
    ?.pages.map((page) => page.messages.map(({ id }) => id));

let queryClient: QueryClient;

beforeEach(() => {
  queryClient = new QueryClient();
});

describe('sortRooms', () => {
  it('puts the newest last message first, and a room without messages where its creation time puts it', () => {
    const rooms = [
      room(1, { lastMessage: { content: 'old', createdAt: '2026-10-10T09:00:00.000Z' } }),
      room(2),
      room(3, { lastMessage: { content: 'new', createdAt: '2026-10-20T09:00:00.000Z' } }),
      room(4, { createdAt: '2026-10-15T09:00:00.000Z' }),
    ];

    expect(sortRooms(rooms).map(({ id }) => id)).toEqual([3, 4, 1, 2]);
  });

  it('breaks a tie by the higher id, and does not change the array it was given', () => {
    const rooms = [room(1), room(2)];

    expect(sortRooms(rooms).map(({ id }) => id)).toEqual([2, 1]);
    expect(rooms.map(({ id }) => id)).toEqual([1, 2]);
  });
});

describe('addMessageToCache', () => {
  it('puts the message at the newest end of the first page', () => {
    queryClient.setQueryData(chatKeys.messages(1), twoPages());

    addMessageToCache(queryClient, message(6));

    expect(idsOf(queryClient)).toEqual([[6, 5, 4], [3, 2, 1]]);
  });

  it('stores a message that arrives twice once (the sender\'s own answer, then the socket event)', () => {
    queryClient.setQueryData(chatKeys.messages(1), twoPages());
    queryClient.setQueryData(chatKeys.list(), [room(1)]);

    addMessageToCache(queryClient, message(6));
    const afterFirst = queryClient.getQueryData(chatKeys.messages(1));
    addMessageToCache(queryClient, message(6));

    expect(idsOf(queryClient)).toEqual([[6, 5, 4], [3, 2, 1]]);
    expect(queryClient.getQueryData(chatKeys.messages(1))).toBe(afterFirst); // not even a new object
  });

  it('does nothing to the messages of a room that was never opened', () => {
    addMessageToCache(queryClient, message(1));

    expect(queryClient.getQueryData(chatKeys.messages(1))).toBeUndefined();
  });

  it('updates the room\'s preview and moves it to the top, and leaves its unread count alone', () => {
    queryClient.setQueryData(chatKeys.list(), [
      room(2, { lastMessage: { content: 'other', createdAt: '2026-10-20T10:00:00.000Z' } }),
      room(1, { unreadCount: 3, lastMessage: { content: 'before', createdAt: '2026-10-20T09:00:00.000Z' } }),
    ]);

    addMessageToCache(queryClient, message(6, { content: 'hello', createdAt: '2026-10-20T11:00:00.000Z' }));

    const rooms = queryClient.getQueryData<ChatRoomSummary[]>(chatKeys.list());
    expect(rooms?.map(({ id }) => id)).toEqual([1, 2]);
    expect(rooms?.[0]?.lastMessage).toEqual({ content: 'hello', createdAt: '2026-10-20T11:00:00.000Z' });
    expect(rooms?.[0]?.unreadCount).toBe(3);
  });

  it('does not let an older message replace a newer preview', () => {
    queryClient.setQueryData(chatKeys.list(), [
      room(1, { lastMessage: { content: 'newest', createdAt: '2026-10-20T12:00:00.000Z' } }),
    ]);

    addMessageToCache(queryClient, message(6, { content: 'late arrival', createdAt: '2026-10-20T09:00:00.000Z' }));

    expect(queryClient.getQueryData<ChatRoomSummary[]>(chatKeys.list())?.[0]?.lastMessage?.content).toBe('newest');
  });
});

describe('replaceMessageInCache', () => {
  it('replaces the message wherever it is loaded, and nothing else', () => {
    queryClient.setQueryData(chatKeys.messages(1), twoPages());

    replaceMessageInCache(queryClient, message(2, { content: 'changed', editedAt: '2026-10-20T10:00:00.000Z' }));

    const pages = queryClient.getQueryData<InfiniteData<MessageListResponse>>(chatKeys.messages(1))?.pages;
    expect(pages?.[1]?.messages.map(({ content }) => content)).toEqual(['message 3', 'changed', 'message 1']);
    expect(pages?.[0]?.messages.map(({ content }) => content)).toEqual(['message 5', 'message 4']);
  });

  it('leaves the cache as it was when the message is not loaded', () => {
    const data = twoPages();
    queryClient.setQueryData(chatKeys.messages(1), data);
    const before = queryClient.getQueryData(chatKeys.messages(1));

    replaceMessageInCache(queryClient, message(99));

    expect(queryClient.getQueryData(chatKeys.messages(1))).toBe(before);
  });
});

describe('markMessageDeletedInCache', () => {
  it('clears the content and sets deletedAt', () => {
    queryClient.setQueryData(chatKeys.messages(1), twoPages());

    markMessageDeletedInCache(queryClient, 1, 4, '2026-10-20T10:00:00.000Z');

    const deleted = queryClient.getQueryData<InfiniteData<MessageListResponse>>(chatKeys.messages(1))?.pages[0]?.messages[1];
    expect(deleted).toMatchObject({ id: 4, content: '', deletedAt: '2026-10-20T10:00:00.000Z' });
  });

  it('keeps the first deletedAt when the same message is deleted again (the socket event after the answer)', () => {
    queryClient.setQueryData(chatKeys.messages(1), twoPages());

    markMessageDeletedInCache(queryClient, 1, 4, '2026-10-20T10:00:00.000Z');
    markMessageDeletedInCache(queryClient, 1, 4, '2026-10-20T10:00:09.000Z');

    const deleted = queryClient.getQueryData<InfiniteData<MessageListResponse>>(chatKeys.messages(1))?.pages[0]?.messages[1];
    expect(deleted?.deletedAt).toBe('2026-10-20T10:00:00.000Z');
  });
});

describe('markRoomReadInCache', () => {
  it('sets that room\'s unread count to 0 and touches no other room', () => {
    queryClient.setQueryData(chatKeys.list(), [room(1, { unreadCount: 3 }), room(2, { unreadCount: 5 })]);

    markRoomReadInCache(queryClient, 1);

    expect(queryClient.getQueryData<ChatRoomSummary[]>(chatKeys.list())?.map(({ unreadCount }) => unreadCount)).toEqual([0, 5]);
  });

  it('does nothing when the room list was never loaded', () => {
    markRoomReadInCache(queryClient, 1);

    expect(queryClient.getQueryData(chatKeys.list())).toBeUndefined();
  });
});

describe('mergeNewestPageIntoCache', () => {
  it('adds what is new, replaces what changed, and leaves the older pages as they were', () => {
    queryClient.setQueryData(chatKeys.messages(1), twoPages());

    const result = mergeNewestPageIntoCache(queryClient, 1, {
      messages: [message(6), message(5), message(4, { content: 'changed', editedAt: '2026-10-20T10:00:00.000Z' })],
      hasMore: true,
    });

    expect(result).toBe('merged');
    const pages = queryClient.getQueryData<InfiniteData<MessageListResponse>>(chatKeys.messages(1))?.pages;
    expect(pages?.map((page) => page.messages.map(({ id }) => id))).toEqual([[6, 5, 4], [3, 2, 1]]);
    expect(pages?.[0]?.messages[2]?.content).toBe('changed');
  });

  it('changes nothing, not even an object, when the newest page is what is already loaded', () => {
    queryClient.setQueryData(chatKeys.messages(1), twoPages());
    queryClient.setQueryData(chatKeys.list(), [room(1)]);
    const messagesBefore = queryClient.getQueryData(chatKeys.messages(1));
    const roomsBefore = queryClient.getQueryData(chatKeys.list());

    mergeNewestPageIntoCache(queryClient, 1, { messages: [message(5), message(4)], hasMore: true });

    expect(queryClient.getQueryData(chatKeys.messages(1))).toBe(messagesBefore);
    expect(queryClient.getQueryData(chatKeys.list())).toBe(roomsBefore);
  });

  it('shows a delete that happened elsewhere', () => {
    queryClient.setQueryData(chatKeys.messages(1), twoPages());

    mergeNewestPageIntoCache(queryClient, 1, {
      messages: [message(5), message(4, { content: '', deletedAt: '2026-10-20T10:00:00.000Z' })],
      hasMore: true,
    });

    const first = queryClient.getQueryData<InfiniteData<MessageListResponse>>(chatKeys.messages(1))?.pages[0];
    expect(first?.messages[1]).toMatchObject({ id: 4, content: '', deletedAt: '2026-10-20T10:00:00.000Z' });
  });

  it('refuses to leave a hole: a page that starts after the newest loaded message is a gap, and changes nothing', () => {
    queryClient.setQueryData(chatKeys.messages(1), twoPages());
    const before = queryClient.getQueryData(chatKeys.messages(1));

    const result = mergeNewestPageIntoCache(queryClient, 1, { messages: [message(60), message(59)], hasMore: true });

    expect(result).toBe('gap');
    expect(queryClient.getQueryData(chatKeys.messages(1))).toBe(before);
  });

  it('is not a gap when the page holds everything there is, however far its ids are from the loaded ones', () => {
    queryClient.setQueryData(chatKeys.messages(1), twoPages());

    expect(mergeNewestPageIntoCache(queryClient, 1, { messages: [message(60)], hasMore: false })).toBe('merged');
  });

  it('does nothing for a room whose messages are not loaded', () => {
    expect(mergeNewestPageIntoCache(queryClient, 1, { messages: [message(1)], hasMore: false })).toBe('merged');
    expect(queryClient.getQueryData(chatKeys.messages(1))).toBeUndefined();
  });
});
