import type { QueryClient } from '@tanstack/react-query';
import { subscribe, type AppSocket } from '@/lib/socket';
import {
  addIncomingMessageToCache,
  applyDeletedMessage,
  applyEditedMessage,
  markRoomReadUpToInCache,
  removeRoomFromCache,
  setMemberReadMarkerInCache,
  updateRoomInCache,
} from './cache';
import { chatKeys } from './keys';
import { syncNewestMessages } from './queries';
import type { ChatRoomSummary } from './types';

const roomsOf = (queryClient: QueryClient) => queryClient.getQueryData<ChatRoomSummary[]>(chatKeys.list());

/**
 * What the server's events do to the cache: the same functions the mutations call, so an event that
 * arrives after the answer of the person's own request (or twice) changes nothing. The socket is a
 * notification layer, so where an event does not carry enough to patch the cache, the query is invalidated:
 * it asks again only if something is showing it, and otherwise the next visit does. Returns the function
 * that stops listening.
 *
 * `onRoomRemoved` is told before the room leaves the cache, so the screen can leave it first.
 */
export function attachChatEvents(
  socket: AppSocket,
  queryClient: QueryClient,
  { userId, onRoomRemoved }: { userId: number; onRoomRemoved: (chatId: number) => void },
): () => void {
  const refreshRooms = () => void queryClient.invalidateQueries({ queryKey: chatKeys.list() });
  const refreshMembers = (chatId: number) => void queryClient.invalidateQueries({ queryKey: chatKeys.members(chatId) });

  return subscribe(socket, {
    'message:new': ({ message }) => {
      if (addIncomingMessageToCache(queryClient, message, userId) === 'unknown_room') refreshRooms();
    },
    'message:updated': ({ message }) => applyEditedMessage(queryClient, message),
    'message:deleted': ({ chatId, messageId, deletedAt }) => {
      const hadUnread = (roomsOf(queryClient)?.find(({ id }) => id === chatId)?.unreadCount ?? 0) > 0;
      const askedForRooms = applyDeletedMessage(queryClient, chatId, messageId, deletedAt);
      // A deleted message is not unread any more, and the cache cannot tell whether this one was counted.
      if (hadUnread && !askedForRooms) refreshRooms();
    },
    'chat:updated': ({ chatId, name, avatarUrl }) => updateRoomInCache(queryClient, { id: chatId, name, avatarUrl }),
    'chat:removed': ({ chatId }) => {
      onRoomRemoved(chatId);
      removeRoomFromCache(queryClient, chatId);
    },
    'member:added': ({ chatId }) => {
      refreshMembers(chatId);
      // The person was added to a room they do not have yet.
      const rooms = roomsOf(queryClient);
      if (rooms && !rooms.some(({ id }) => id === chatId)) refreshRooms();
    },
    'member:removed': ({ chatId }) => refreshMembers(chatId),
    'member:role_changed': ({ chatId }) => refreshMembers(chatId),
    'read:updated': ({ chatId, userId: readerId, lastReadMessageId }) => {
      if (readerId !== userId) return setMemberReadMarkerInCache(queryClient, chatId, readerId, lastReadMessageId);
      if (markRoomReadUpToInCache(queryClient, chatId, lastReadMessageId) === 'unknown') refreshRooms();
    },
  });
}

/**
 * After a reconnect: events sent while the socket was down are gone, so what they would have said is
 * asked for. The room list and the member lists are invalidated. A conversation that is open is caught
 * up (the newest page merged, a hole closed: see `syncNewestMessages`; refetching its query would
 * ask for every loaded page), and one that is cached but not on screen is dropped, to load fresh when
 * it is opened.
 */
export function resyncChats(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: chatKeys.list() });
  void queryClient.invalidateQueries({ queryKey: chatKeys.allMembers() });

  for (const query of queryClient.getQueryCache().findAll({ queryKey: chatKeys.allMessages() })) {
    const chatId = query.queryKey[2] as number;
    if (query.getObserversCount() === 0) {
      queryClient.removeQueries({ queryKey: chatKeys.messages(chatId), exact: true });
    } else {
      syncNewestMessages(queryClient, chatId).catch(() => {
        // The merge could not be made (the connection is down again, say): the whole conversation is asked for instead.
        void queryClient.invalidateQueries({ queryKey: chatKeys.messages(chatId), exact: true });
      });
    }
  }
}
