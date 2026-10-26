import {
  infiniteQueryOptions,
  queryOptions,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { deleteMessage, editMessage, getChatRooms, getMessages, markRead, sendMessage } from './api';
import {
  addMessageToCache,
  markMessageDeletedInCache,
  markRoomReadInCache,
  mergeNewestPageIntoCache,
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
    queryFn: ({ pageParam, signal }) => getMessages(chatId, pageParam, signal),
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
      const page = await getMessages(chatId, undefined, signal);
      if (mergeNewestPageIntoCache(queryClient, chatId, page) === 'gap') {
        void queryClient.invalidateQueries({ queryKey: chatKeys.messages(chatId), exact: true });
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
      // The room's `lastMessage` has no id, so the cache cannot tell whether this was it: one GET settles it.
      void queryClient.invalidateQueries({ queryKey: chatKeys.list() });
    },
  });
}

export function useDeleteMessage(chatId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (messageId: number) => deleteMessage(chatId, messageId),
    onSuccess: (_result, messageId) => {
      markMessageDeletedInCache(queryClient, chatId, messageId, new Date().toISOString());
      // If it was the newest message, the preview falls back to the one before it, which only the server knows.
      void queryClient.invalidateQueries({ queryKey: chatKeys.list() });
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
