import {
  infiniteQueryOptions,
  queryOptions,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { isApiError } from '@/lib/http';
import {
  addMembers,
  changeMemberRole,
  createDirectChatRoom,
  createGroupChatRoom,
  deleteChatRoom,
  deleteMessage,
  editMessage,
  getChatRooms,
  getMembers,
  getMessages,
  markRead,
  removeMember,
  sendMessage,
  updateChatRoom,
  type UpdateRoomInput,
} from './api';
import {
  addMembersToCache,
  addMessageToCache,
  addRoomToCache,
  markMessageDeletedInCache,
  markRoomReadInCache,
  mergeNewestPageIntoCache,
  newestLoadedMessageId,
  refreshPreviewAfterChange,
  removeMemberFromCache,
  removeRoomFromCache,
  replaceMemberInCache,
  replaceMessageInCache,
  sortMembers,
  updateRoomInCache,
} from './cache';
import { chatKeys } from './keys';
import type { Role } from './types';

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
    queryFn: ({ pageParam, signal }) =>
      getMessages(chatId, pageParam === undefined ? {} : { before: pageParam }, signal),
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

/** Makes the direct room with a friend, or finds the one that exists; the caller goes to `room.id`. */
export function useStartDirectChat() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createDirectChatRoom,
    onSuccess: (room) => addRoomToCache(queryClient, room),
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

export function useMembers(chatId: number) {
  return useQuery({
    queryKey: chatKeys.members(chatId),
    queryFn: ({ signal }) => getMembers(chatId, signal),
  });
}

/**
 * A refusal that means the room or its members are not what the screen shows (the member is gone, the room
 * was deleted, the last admin cannot go): ask the server again, and the server's text says why.
 */
function refreshWhenOutOfDate(queryClient: QueryClient, chatId: number, error: unknown): void {
  if (isApiError(error) && (error.status === 404 || error.status === 409)) {
    void queryClient.invalidateQueries({ queryKey: chatKeys.members(chatId) });
    void queryClient.invalidateQueries({ queryKey: chatKeys.list() });
  }
}

/** Makes a group room; the room goes into the list and its members, which the answer has, into the member cache. The caller goes to `room.id`. */
export function useCreateGroupChat() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createGroupChatRoom,
    onSuccess: (room) => {
      addRoomToCache(queryClient, room);
      queryClient.setQueryData(chatKeys.members(room.id), sortMembers(room.members));
    },
  });
}

/** The new name and avatar are in the room list at once, from the answer. */
export function useUpdateChatRoom(chatId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateRoomInput) => updateChatRoom(chatId, input),
    onSuccess: (room) => updateRoomInCache(queryClient, room),
    onError: (error) => refreshWhenOutOfDate(queryClient, chatId, error),
  });
}

/** The room is out of the cache for good: the caller leaves for the room list. */
export function useDeleteChatRoom(chatId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => deleteChatRoom(chatId),
    onSuccess: () => removeRoomFromCache(queryClient, chatId),
    onError: (error) => refreshWhenOutOfDate(queryClient, chatId, error),
  });
}

export function useAddMembers(chatId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (memberIds: number[]) => addMembers(chatId, memberIds),
    onSuccess: ({ addedMembers }) => addMembersToCache(queryClient, chatId, addedMembers),
    onError: (error) => refreshWhenOutOfDate(queryClient, chatId, error),
  });
}

/** Removes someone else; the variable is their user id. */
export function useRemoveMember(chatId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: number) => removeMember(chatId, userId),
    onSuccess: (_result, userId) => removeMemberFromCache(queryClient, chatId, userId),
    onError: (error) => refreshWhenOutOfDate(queryClient, chatId, error),
  });
}

/** The person removes themself: the room is gone for them, so it leaves the cache and the caller leaves for the room list. */
export function useLeaveChatRoom(chatId: number, userId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => removeMember(chatId, userId),
    onSuccess: () => removeRoomFromCache(queryClient, chatId),
    onError: (error) => refreshWhenOutOfDate(queryClient, chatId, error),
  });
}

export function useChangeMemberRole(chatId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, role }: { userId: number; role: Role }) => changeMemberRole(chatId, userId, role),
    onSuccess: (member) => replaceMemberInCache(queryClient, member),
    onError: (error) => refreshWhenOutOfDate(queryClient, chatId, error),
  });
}
