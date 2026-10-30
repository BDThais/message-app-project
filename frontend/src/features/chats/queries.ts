import {
  infiniteQueryOptions,
  queryOptions,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { deleteMessage, editMessage, getChatRooms, getMessages, markRead, sendMessage } from './api';
import {
  addMessageToCache,
  markMessageDeletedInCache,
  markRoomReadInCache,
  mergeNewestPageIntoCache,
  newestLoadedMessageId,
  refreshPreviewAfterChange,
  replaceMessageInCache,
} from './cache';
import { chatKeys } from './keys';

// Until step 6 the screens ask again every few seconds so that other people's messages show up; the
// socket pushes them instead, and step 6 removes this, `useNewestMessagesPolling` and the
// `refetchInterval` below. A background tab does not poll (TanStack Query's default).
export const POLL_INTERVAL_MS = 5_000;

export function chatRoomsQueryOptions() {
  return queryOptions({
    queryKey: chatKeys.list(),
    queryFn: ({ signal }) => getChatRooms(signal),
    refetchInterval: POLL_INTERVAL_MS,
  });
}

export function useChatRooms() {
  return useQuery(chatRoomsQueryOptions());
}

/** Pages arrive newest first, and the next page starts below the oldest message of the last one. */
export function messagesQueryOptions(chatId: number) {
  return infiniteQueryOptions({
    queryKey: chatKeys.messages(chatId),
    queryFn: ({ pageParam, signal }) => getMessages(chatId, pageParam === undefined ? {} : { before: pageParam }, signal),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.messages.at(-1)?.id : undefined),
  });
}

export function useMessages(chatId: number) {
  const query = useInfiniteQuery(messagesQueryOptions(chatId));
  useNewestMessagesPolling(chatId, query.isSuccess);
  return query;
}

/**
 * Fetches everything newer than the newest message loaded, a page at a time with the `after` cursor
 * (step 6's reconnect will do the same), and adds it, oldest first. False when it cannot: nothing is
 * loaded to start from, or a page did not move the newest message on.
 */
async function catchUp(queryClient: QueryClient, chatId: number, signal: AbortSignal): Promise<boolean> {
  for (;;) {
    const newestLoaded = newestLoadedMessageId(queryClient, chatId);
    if (newestLoaded === undefined) return false;
    const page = await getMessages(chatId, { after: newestLoaded }, signal);
    for (const message of [...page.messages].reverse()) addMessageToCache(queryClient, message);
    if (!page.hasMore) return true;
    if ((newestLoadedMessageId(queryClient, chatId) ?? 0) <= newestLoaded) return false;
  }
}

/**
 * Asks for the newest page only and merges it into the loaded messages. The messages' own query is
 * not given a `refetchInterval` because an infinite query refetches every page it holds, one request
 * for each, and derives each page's cursor from the page before it: with a new message the loaded
 * window slides by one, and the oldest message on screen disappears from above the person's eyes.
 */
function useNewestMessagesPolling(chatId: number, enabled: boolean): void {
  const queryClient = useQueryClient();
  useQuery({
    queryKey: [...chatKeys.messages(chatId), 'newest'],
    queryFn: async ({ signal }) => {
      const page = await getMessages(chatId, {}, signal);
      if (mergeNewestPageIntoCache(queryClient, chatId, page) === 'gap') {
        // The catch-up fetches every message of the page again (they are all newer than what is loaded).
        if (!(await catchUp(queryClient, chatId, signal))) {
          void queryClient.invalidateQueries({ queryKey: chatKeys.messages(chatId), exact: true });
        }
      }
      return null;
    },
    enabled,
    refetchInterval: POLL_INTERVAL_MS,
    // It has no data of its own: what it fetches goes into the messages' cache entry. `initialData` and
    // `refetchOnMount: false` keep it from asking at once for the page that was just loaded.
    initialData: null,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    gcTime: 0,
  });
}

export function useSendMessage(chatId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (content: string) => sendMessage(chatId, content),
    onSuccess: (message) => addMessageToCache(queryClient, message),
  });
}

export function useEditMessage(chatId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ messageId, content }: { messageId: number; content: string }) =>
      editMessage(chatId, messageId, content),
    onSuccess: (message) => {
      replaceMessageInCache(queryClient, message);
      if (refreshPreviewAfterChange(queryClient, message.chatId, message.id) === 'unknown') {
        void queryClient.invalidateQueries({ queryKey: chatKeys.list() });
      }
    },
  });
}

export function useDeleteMessage(chatId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (messageId: number) => deleteMessage(chatId, messageId),
    onSuccess: (_result, messageId) => {
      markMessageDeletedInCache(queryClient, chatId, messageId, new Date().toISOString());
      // If it was the preview, the room falls back to the message before it: the loaded ones say which, unless there are none to say.
      if (refreshPreviewAfterChange(queryClient, chatId, messageId) === 'unknown') {
        void queryClient.invalidateQueries({ queryKey: chatKeys.list() });
      }
    },
  });
}

export function useMarkRead(chatId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (messageId: number) => markRead(chatId, messageId),
    onSuccess: () => markRoomReadInCache(queryClient, chatId),
  });
}
