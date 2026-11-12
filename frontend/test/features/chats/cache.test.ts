import { QueryClient, type InfiniteData } from '@tanstack/react-query';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  addIncomingMessageToCache,
  addMessageToCache,
  addRoomToCache,
  applyDeletedMessage,
  applyEditedMessage,
  markMessageDeletedInCache,
  markRoomReadInCache,
  markRoomReadUpToInCache,
  mergeNewestPageIntoCache,
  refreshPreviewAfterChange,
  replaceMessageInCache,
  setMemberReadMarkerInCache,
  sortRooms,
  updateRoomInCache,
} from '@/features/chats/cache';
import { chatKeys } from '@/features/chats/keys';
import type { ChatRoomSummary, CreatedChatRoom, Member, Message, MessageListResponse } from '@/features/chats/types';

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

/** A room's `lastMessage`, as the server sends it. */
function preview(id: number, content: string, createdAt: string, senderId: number | null = 2) {
  return { id, senderId, content, createdAt };
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
      room(1, { lastMessage: preview(1, 'old', '2026-10-10T09:00:00.000Z') }),
      room(2),
      room(3, { lastMessage: preview(3, 'new', '2026-10-20T09:00:00.000Z') }),
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

    expect(idsOf(queryClient)).toEqual([
      [6, 5, 4],
      [3, 2, 1],
    ]);
  });

  it("stores a message that arrives twice once (the sender's own answer, then the socket event)", () => {
    queryClient.setQueryData(chatKeys.messages(1), twoPages());
    queryClient.setQueryData(chatKeys.list(), [room(1)]);

    addMessageToCache(queryClient, message(6));
    const afterFirst = queryClient.getQueryData(chatKeys.messages(1));
    addMessageToCache(queryClient, message(6));

    expect(idsOf(queryClient)).toEqual([
      [6, 5, 4],
      [3, 2, 1],
    ]);
    expect(queryClient.getQueryData(chatKeys.messages(1))).toBe(afterFirst); // not even a new object
  });

  it('does nothing to the messages of a room that was never opened', () => {
    addMessageToCache(queryClient, message(1));

    expect(queryClient.getQueryData(chatKeys.messages(1))).toBeUndefined();
  });

  it("updates the room's preview and moves it to the top, and leaves its unread count alone", () => {
    queryClient.setQueryData(chatKeys.list(), [
      room(2, { lastMessage: preview(20, 'other', '2026-10-20T10:00:00.000Z') }),
      room(1, { unreadCount: 3, lastMessage: preview(5, 'before', '2026-10-20T09:00:00.000Z') }),
    ]);

    addMessageToCache(queryClient, message(6, { content: 'hello', createdAt: '2026-10-20T11:00:00.000Z' }));

    const rooms = queryClient.getQueryData<ChatRoomSummary[]>(chatKeys.list());
    expect(rooms?.map(({ id }) => id)).toEqual([1, 2]);
    expect(rooms?.[0]?.lastMessage).toEqual({
      id: 6,
      senderId: 2,
      content: 'hello',
      createdAt: '2026-10-20T11:00:00.000Z',
    });
    expect(rooms?.[0]?.unreadCount).toBe(3);
  });

  it('does not let an older message replace a newer preview', () => {
    queryClient.setQueryData(chatKeys.list(), [
      room(1, { lastMessage: preview(9, 'newest', '2026-10-20T12:00:00.000Z') }),
    ]);

    addMessageToCache(queryClient, message(6, { content: 'late arrival' }));

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

    const deleted = queryClient.getQueryData<InfiniteData<MessageListResponse>>(chatKeys.messages(1))?.pages[0]
      ?.messages[1];
    expect(deleted).toMatchObject({ id: 4, content: '', deletedAt: '2026-10-20T10:00:00.000Z' });
  });

  it('keeps the first deletedAt when the same message is deleted again (the socket event after the answer)', () => {
    queryClient.setQueryData(chatKeys.messages(1), twoPages());

    markMessageDeletedInCache(queryClient, 1, 4, '2026-10-20T10:00:00.000Z');
    markMessageDeletedInCache(queryClient, 1, 4, '2026-10-20T10:00:09.000Z');

    const deleted = queryClient.getQueryData<InfiniteData<MessageListResponse>>(chatKeys.messages(1))?.pages[0]
      ?.messages[1];
    expect(deleted?.deletedAt).toBe('2026-10-20T10:00:00.000Z');
  });
});

describe('markRoomReadInCache', () => {
  it("sets that room's unread count to 0 and touches no other room", () => {
    queryClient.setQueryData(chatKeys.list(), [room(1, { unreadCount: 3 }), room(2, { unreadCount: 5 })]);

    markRoomReadInCache(queryClient, 1);

    expect(queryClient.getQueryData<ChatRoomSummary[]>(chatKeys.list())?.map(({ unreadCount }) => unreadCount)).toEqual(
      [0, 5],
    );
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
    expect(pages?.map((page) => page.messages.map(({ id }) => id))).toEqual([
      [6, 5, 4],
      [3, 2, 1],
    ]);
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

  it('is a gap when nothing is loaded and there is more behind the page: there is nothing to catch up from', () => {
    queryClient.setQueryData(chatKeys.messages(1), {
      pages: [{ messages: [], hasMore: false }],
      pageParams: [undefined],
    });

    const result = mergeNewestPageIntoCache(queryClient, 1, { messages: [message(60), message(59)], hasMore: true });

    expect(result).toBe('gap');
    expect(idsOf(queryClient)).toEqual([[]]);
  });

  it('adds the whole page to a conversation with nothing loaded when nothing is behind it', () => {
    queryClient.setQueryData(chatKeys.messages(1), {
      pages: [{ messages: [], hasMore: false }],
      pageParams: [undefined],
    });

    const result = mergeNewestPageIntoCache(queryClient, 1, { messages: [message(2), message(1)], hasMore: false });

    expect(result).toBe('merged');
    expect(idsOf(queryClient)).toEqual([[2, 1]]);
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

describe('refreshPreviewAfterChange', () => {
  const previewIn = (rooms: ChatRoomSummary[] | undefined, id = 1) =>
    rooms?.find((each) => each.id === id)?.lastMessage;
  const list = () => queryClient.getQueryData<ChatRoomSummary[]>(chatKeys.list());

  it('shows the new text when the edited message is the preview', () => {
    queryClient.setQueryData(chatKeys.messages(1), twoPages());
    queryClient.setQueryData(chatKeys.list(), [
      room(1, { lastMessage: preview(5, 'message 5', message(5).createdAt) }),
    ]);
    replaceMessageInCache(queryClient, message(5, { content: 'fixed', editedAt: '2026-10-20T10:00:00.000Z' }));

    expect(refreshPreviewAfterChange(queryClient, 1, 5)).toBe('updated');

    expect(previewIn(list())).toEqual({ id: 5, senderId: 2, content: 'fixed', createdAt: message(5).createdAt });
  });

  it('falls back to the newest message that is not deleted when the preview was deleted, and moves the room down', () => {
    queryClient.setQueryData(chatKeys.messages(1), twoPages());
    queryClient.setQueryData(chatKeys.list(), [
      room(1, { lastMessage: preview(5, 'message 5', '2026-10-20T09:00:05.000Z') }),
      room(2, { lastMessage: preview(50, 'elsewhere', '2026-10-20T09:00:03.000Z') }),
    ]);
    markMessageDeletedInCache(queryClient, 1, 5, '2026-10-20T10:00:00.000Z');
    markMessageDeletedInCache(queryClient, 1, 4, '2026-10-20T10:00:00.000Z');

    expect(refreshPreviewAfterChange(queryClient, 1, 5)).toBe('updated');

    expect(previewIn(list())).toMatchObject({ id: 3, content: 'message 3' }); // 09:00:03 ties with room 2: the higher id is first
    expect(list()?.map(({ id }) => id)).toEqual([2, 1]);
  });

  it('leaves the cache alone when the changed message is not the preview', () => {
    queryClient.setQueryData(chatKeys.messages(1), twoPages());
    queryClient.setQueryData(chatKeys.list(), [
      room(1, { lastMessage: preview(5, 'message 5', message(5).createdAt) }),
    ]);
    markMessageDeletedInCache(queryClient, 1, 4, '2026-10-20T10:00:00.000Z');
    const before = list();

    expect(refreshPreviewAfterChange(queryClient, 1, 4)).toBe('unchanged');

    expect(list()).toBe(before);
  });

  it('is unchanged when the room list was never loaded', () => {
    expect(refreshPreviewAfterChange(queryClient, 1, 5)).toBe('unchanged');
  });

  it('has no preview when everything is loaded and everything is deleted', () => {
    queryClient.setQueryData(chatKeys.messages(1), {
      pages: [
        {
          messages: [
            message(2, { content: '', deletedAt: '2026-10-20T10:00:00.000Z' }),
            message(1, { content: '', deletedAt: '2026-10-20T10:00:00.000Z' }),
          ],
          hasMore: false,
        },
      ],
      pageParams: [undefined],
    });
    queryClient.setQueryData(chatKeys.list(), [room(1, { lastMessage: preview(2, 'two', message(2).createdAt) })]);

    expect(refreshPreviewAfterChange(queryClient, 1, 2)).toBe('updated');

    expect(previewIn(list())).toBeNull();
  });

  it('cannot say, and changes nothing, when the loaded messages are all deleted and older ones are behind them', () => {
    const deleted = { content: '', deletedAt: '2026-10-20T10:00:00.000Z' };
    queryClient.setQueryData(chatKeys.messages(1), {
      pages: [{ messages: [message(5, deleted), message(4, deleted)], hasMore: true }],
      pageParams: [undefined],
    });
    queryClient.setQueryData(chatKeys.list(), [room(1, { lastMessage: preview(5, 'five', message(5).createdAt) })]);
    const before = list();

    expect(refreshPreviewAfterChange(queryClient, 1, 5)).toBe('unknown');

    expect(list()).toBe(before);
  });

  it("cannot say when the room's messages were never loaded", () => {
    queryClient.setQueryData(chatKeys.list(), [room(1, { lastMessage: preview(5, 'five', message(5).createdAt) })]);

    expect(refreshPreviewAfterChange(queryClient, 1, 5)).toBe('unknown');
  });
});

describe('addRoomToCache', () => {
  /** What POST /api/chat answers: the summary, the person's own role, and the members. */
  function created(id: number, overrides: Partial<CreatedChatRoom> = {}): CreatedChatRoom {
    return { ...room(id), role: 'admin', members: [], ...overrides };
  }
  const listOf = (queryClient: QueryClient) => queryClient.getQueryData<ChatRoomSummary[]>(chatKeys.list());

  it('puts a new room into the list in its place, and keeps neither `role` nor `members` there', () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(chatKeys.list(), [
      room(1, { lastMessage: preview(9, 'later', '2026-10-21T09:00:00.000Z') }),
      room(2, { lastMessage: preview(8, 'earlier', '2026-10-19T09:00:00.000Z') }),
    ]);

    addRoomToCache(queryClient, created(3, { createdAt: '2026-10-20T09:00:00.000Z' }));

    expect(listOf(queryClient)?.map(({ id }) => id)).toEqual([1, 3, 2]);
    expect(listOf(queryClient)?.find(({ id }) => id === 3)).toEqual(room(3, { createdAt: '2026-10-20T09:00:00.000Z' }));
  });

  it('replaces the entry of a room that is there already, so that asking twice stores it once', () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(chatKeys.list(), [room(1, { unreadCount: 4 })]);

    addRoomToCache(queryClient, created(1, { unreadCount: 2 }));
    addRoomToCache(queryClient, created(1, { unreadCount: 2 }));

    expect(listOf(queryClient)).toEqual([room(1, { unreadCount: 2 })]);
  });

  it('leaves a list that was never loaded alone: the server has the room', () => {
    const queryClient = new QueryClient();

    addRoomToCache(queryClient, created(1));

    expect(listOf(queryClient)).toBeUndefined();
  });
});

describe('addIncomingMessageToCache', () => {
  const ME = 1;
  const unreadOf = (id: number) =>
    queryClient.getQueryData<ChatRoomSummary[]>(chatKeys.list())?.find((each) => each.id === id)?.unreadCount;

  it("adds somebody else's message to the room, its preview and its unread count", () => {
    queryClient.setQueryData(chatKeys.list(), [
      room(1, { lastMessage: preview(4, 'message 4', '2026-10-20T09:00:04.000Z') }),
    ]);
    queryClient.setQueryData(chatKeys.messages(1), twoPages());

    expect(addIncomingMessageToCache(queryClient, message(6), ME)).toBe('applied');

    expect(idsOf(queryClient)?.[0]).toEqual([6, 5, 4]);
    expect(queryClient.getQueryData<ChatRoomSummary[]>(chatKeys.list())?.[0]?.lastMessage?.id).toBe(6);
    expect(unreadOf(1)).toBe(1);
  });

  it('counts a message once however often it arrives, because the preview is what it is judged against', () => {
    queryClient.setQueryData(chatKeys.list(), [room(1)]);

    addIncomingMessageToCache(queryClient, message(6), ME);
    addIncomingMessageToCache(queryClient, message(6), ME);

    expect(unreadOf(1)).toBe(1);
  });

  it("does not count the person's own message, and does put it in the room", () => {
    queryClient.setQueryData(chatKeys.list(), [room(1)]);

    addIncomingMessageToCache(queryClient, message(6, { senderId: ME }), ME);

    expect(unreadOf(1)).toBe(0);
    expect(queryClient.getQueryData<ChatRoomSummary[]>(chatKeys.list())?.[0]?.lastMessage?.id).toBe(6);
  });

  it("counts a message whose sender's account is gone: it is nobody's own", () => {
    queryClient.setQueryData(chatKeys.list(), [room(1)]);

    addIncomingMessageToCache(queryClient, message(6, { senderId: null, sender: null }), ME);

    expect(unreadOf(1)).toBe(1);
  });

  it("does not count a message that is not newer than the room preview (the sender's own answer set it already)", () => {
    queryClient.setQueryData(chatKeys.list(), [
      room(1, { lastMessage: preview(6, 'message 6', '2026-10-20T09:00:06.000Z') }),
    ]);

    addIncomingMessageToCache(queryClient, message(6), ME);

    expect(unreadOf(1)).toBe(0);
  });

  it("answers 'unknown_room' for a room the loaded list does not have, and 'applied' while no list is loaded", () => {
    queryClient.setQueryData(chatKeys.list(), [room(2)]);
    expect(addIncomingMessageToCache(queryClient, message(6), ME)).toBe('unknown_room');

    queryClient.removeQueries({ queryKey: chatKeys.list() });
    expect(addIncomingMessageToCache(queryClient, message(7), ME)).toBe('applied');
    expect(queryClient.getQueryData(chatKeys.list())).toBeUndefined();
  });
});

describe('applyEditedMessage and applyDeletedMessage', () => {
  it('say whether they asked for the room list: only when the loaded messages could not say what the preview is now', () => {
    queryClient.setQueryData(chatKeys.list(), [
      room(1, { lastMessage: preview(5, 'message 5', '2026-10-20T09:00:05.000Z') }),
    ]);
    // Not loaded: the preview was the message, and nothing can say what it is now.
    expect(applyEditedMessage(queryClient, message(5, { content: 'edited' }))).toBe(true);
    expect(applyDeletedMessage(queryClient, 1, 5, '2026-10-20T10:00:00.000Z')).toBe(true);

    queryClient.setQueryData(chatKeys.messages(1), twoPages());
    expect(applyEditedMessage(queryClient, message(5, { content: 'edited' }))).toBe(false);
    expect(applyDeletedMessage(queryClient, 1, 4, '2026-10-20T10:00:00.000Z')).toBe(false); // not the preview
    expect(queryClient.getQueryData<ChatRoomSummary[]>(chatKeys.list())?.[0]?.lastMessage?.content).toBe('edited');
  });
});

describe('markRoomReadUpToInCache', () => {
  const list = (unreadCount: number) =>
    queryClient.setQueryData(chatKeys.list(), [
      room(1, { unreadCount, lastMessage: preview(5, 'message 5', '2026-10-20T09:00:05.000Z') }),
    ]);
  const unread = () => queryClient.getQueryData<ChatRoomSummary[]>(chatKeys.list())?.[0]?.unreadCount;

  it('clears the count when the marker reached the preview, or went past it', () => {
    list(2);
    expect(markRoomReadUpToInCache(queryClient, 1, 5)).toBe('applied');
    expect(unread()).toBe(0);

    list(2);
    expect(markRoomReadUpToInCache(queryClient, 1, 9)).toBe('applied');
    expect(unread()).toBe(0);
  });

  it("answers 'unknown' and keeps the count when the marker stopped short: the server counts what is left", () => {
    list(2);

    expect(markRoomReadUpToInCache(queryClient, 1, 3)).toBe('unknown');
    expect(unread()).toBe(2);
  });

  it('has nothing to do for a room with nothing unread or one that is not in the list', () => {
    list(0);
    expect(markRoomReadUpToInCache(queryClient, 1, 1)).toBe('applied');
    expect(markRoomReadUpToInCache(queryClient, 9, 1)).toBe('applied');
  });
});

describe('setMemberReadMarkerInCache', () => {
  const member = (id: number, lastReadMessageId: number | null): Member => ({
    chatId: 1,
    role: 'member',
    lastReadMessageId,
    member: { id, name: `User ${id}`, avatarUrl: null },
  });
  const markers = () => queryClient.getQueryData<Member[]>(chatKeys.members(1))?.map((each) => each.lastReadMessageId);

  it("moves one member's marker forward and never backwards", () => {
    queryClient.setQueryData(chatKeys.members(1), [member(2, 3), member(3, null)]);

    setMemberReadMarkerInCache(queryClient, 1, 2, 7);
    setMemberReadMarkerInCache(queryClient, 1, 3, 4);
    expect(markers()).toEqual([7, 4]);

    setMemberReadMarkerInCache(queryClient, 1, 2, 5);
    expect(markers()).toEqual([7, 4]);
  });

  it('leaves a member list that is not loaded alone', () => {
    setMemberReadMarkerInCache(queryClient, 1, 2, 7);

    expect(queryClient.getQueryData(chatKeys.members(1))).toBeUndefined();
  });
});

describe('updateRoomInCache', () => {
  it("changes a room's name and avatar and nothing else, from the whole room or from the socket's three fields", () => {
    queryClient.setQueryData(chatKeys.list(), [
      room(1, { name: 'Old', unreadCount: 2, lastMessage: preview(5, 'message 5', '2026-10-20T09:00:05.000Z') }),
      room(2),
    ]);

    updateRoomInCache(queryClient, { id: 1, name: 'New', avatarUrl: 'https://example.com/a.png' });

    expect(
      queryClient
        .getQueryData<ChatRoomSummary[]>(chatKeys.list())
        ?.map(({ name, avatarUrl, unreadCount }) => [name, avatarUrl, unreadCount]),
    ).toEqual([
      ['New', 'https://example.com/a.png', 2],
      ['Room 2', null, 0],
    ]);
  });
});
