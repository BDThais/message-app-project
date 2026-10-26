import { replaceEqualDeep, type InfiniteData, type QueryClient } from '@tanstack/react-query';
import { chatKeys } from './keys';
import type { ChatRoomSummary, Message, MessageListResponse } from './types';

// Every change to what the server told us goes through one of these functions: the mutations call
// them with what the API answered, and the socket handlers of step 6 will call the same ones. So each
// must be idempotent by id: a message that arrives twice (the sender's own response and the socket
// event) is stored once.

type MessagePages = InfiniteData<MessageListResponse, number | undefined>;

/** The order GET /api/chat uses: the newest last message first, a room without messages by its creation time. */
export function sortRooms(rooms: ChatRoomSummary[]): ChatRoomSummary[] {
  const timeOf = (room: ChatRoomSummary) => room.lastMessage?.createdAt ?? room.createdAt;
  return [...rooms].sort((a, b) => {
    const [timeA, timeB] = [timeOf(a), timeOf(b)];
    if (timeA === timeB) return b.id - a.id;
    return timeA < timeB ? 1 : -1;
  });
}

function updatePages(
  queryClient: QueryClient,
  chatId: number,
  update: (pages: MessageListResponse[]) => MessageListResponse[],
): void {
  // Returning undefined leaves the cache alone: a room whose messages were never loaded has nothing to patch.
  queryClient.setQueryData<MessagePages>(chatKeys.messages(chatId), (data) => {
    if (!data) return undefined;
    const pages = update(data.pages);
    return pages === data.pages ? data : { ...data, pages };
  });
}

/** Changes the message with this id wherever it is loaded; the same `pages` come back when nothing changed (not loaded, or `change` returned the message it was given). */
function changeMessage(
  pages: MessageListResponse[],
  messageId: number,
  change: (message: Message) => Message,
): MessageListResponse[] {
  let changed = false;
  const next = pages.map((page) => {
    const index = page.messages.findIndex(({ id }) => id === messageId);
    const current = page.messages[index];
    if (!current) return page;
    const updated = change(current);
    if (updated === current) return page;
    changed = true;
    return { ...page, messages: page.messages.with(index, updated) };
  });
  return changed ? next : pages;
}

/** A message the person sent (or, from step 6, one that arrived): into its room's messages and its room's preview. */
export function addMessageToCache(queryClient: QueryClient, message: Message): void {
  updatePages(queryClient, message.chatId, (pages) => {
    if (pages.some((page) => page.messages.some(({ id }) => id === message.id))) return pages;
    return pages.map((page, index) =>
      index === 0 ? { ...page, messages: [...page.messages, message].sort((a, b) => b.id - a.id) } : page,
    );
  });

  queryClient.setQueryData<ChatRoomSummary[]>(chatKeys.list(), (rooms) => {
    if (!rooms) return undefined;
    const preview = { content: message.content, createdAt: message.createdAt };
    return sortRooms(
      rooms.map((room) =>
        room.id === message.chatId && (room.lastMessage?.createdAt ?? '') <= preview.createdAt
          ? { ...room, lastMessage: preview }
          : room,
      ),
    );
  });
}

/** An edited message, as the API returned it. A message that did not change stays the very same object, so nothing re-renders. */
export function replaceMessageInCache(queryClient: QueryClient, message: Message): void {
  updatePages(queryClient, message.chatId, (pages) =>
    changeMessage(pages, message.id, (current) => replaceEqualDeep(current, message)),
  );
}

/**
 * The newest page, fetched again: what is new is added and what is loaded is replaced (an edit, a
 * delete). Answers 'gap' and changes nothing when the page does not reach back to the newest message
 * loaded (too many arrived at once, or the tab slept): adding them would leave a hole in the
 * conversation, so the caller loads the messages again.
 */
export function mergeNewestPageIntoCache(
  queryClient: QueryClient,
  chatId: number,
  page: MessageListResponse,
): 'merged' | 'gap' {
  const data = queryClient.getQueryData<MessagePages>(chatKeys.messages(chatId));
  if (!data) return 'merged';

  const newestLoaded = data.pages[0]?.messages[0];
  const oldestInPage = page.messages.at(-1);
  if (newestLoaded && oldestInPage && page.hasMore && oldestInPage.id > newestLoaded.id) return 'gap';

  const loaded = new Set(data.pages.flatMap((loadedPage) => loadedPage.messages.map(({ id }) => id)));
  for (const message of [...page.messages].reverse()) {
    if (loaded.has(message.id)) replaceMessageInCache(queryClient, message);
    else addMessageToCache(queryClient, message);
  }
  return 'merged';
}

/** DELETE answers 204 with no message, so the cache makes the deleted one: no content and a `deletedAt`. */
export function markMessageDeletedInCache(
  queryClient: QueryClient,
  chatId: number,
  messageId: number,
  deletedAt: string,
): void {
  updatePages(queryClient, chatId, (pages) =>
    changeMessage(pages, messageId, (message) => (message.deletedAt ? message : { ...message, content: '', deletedAt })),
  );
}

export function markRoomReadInCache(queryClient: QueryClient, chatId: number): void {
  queryClient.setQueryData<ChatRoomSummary[]>(chatKeys.list(), (rooms) =>
    rooms?.map((room) => (room.id === chatId && room.unreadCount !== 0 ? { ...room, unreadCount: 0 } : room)),
  );
}
