import { replaceEqualDeep, type InfiniteData, type QueryClient } from '@tanstack/react-query';
import { chatKeys } from './keys';
import type { ChatRoomSummary, CreatedChatRoom, Member, Message, MessageListResponse } from './types';

// Every change to what the server told us goes through one of these functions: the mutations call
// them with what the API answered, and the socket handlers (events.ts) call the same ones. So each
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

type Preview = NonNullable<ChatRoomSummary['lastMessage']>;

function previewOf({ id, senderId, content, createdAt }: Message): Preview {
  return { id, senderId, content, createdAt };
}

/**
 * A room that POST /api/chat answered with, whether it made it (201) or found it (200): into the room
 * list, or over its entry there. The answer carries the room's own `name`, `lastMessage` and
 * `unreadCount` (a direct room's name is the other member's), so it is a summary with two keys more.
 */
export function addRoomToCache(queryClient: QueryClient, room: CreatedChatRoom): void {
  const summary: ChatRoomSummary = {
    id: room.id,
    type: room.type,
    name: room.name,
    avatarUrl: room.avatarUrl,
    createdAt: room.createdAt,
    lastMessage: room.lastMessage,
    unreadCount: room.unreadCount,
  };
  // A list that is not loaded yet is left alone: it will ask the server, which has the room.
  queryClient.setQueryData<ChatRoomSummary[]>(
    chatKeys.list(),
    (rooms) => rooms && sortRooms([...rooms.filter(({ id }) => id !== summary.id), summary]),
  );
}

/** The id of the newest message loaded in the room, or undefined when none is. */
export function newestLoadedMessageId(queryClient: QueryClient, chatId: number): number | undefined {
  return queryClient.getQueryData<MessagePages>(chatKeys.messages(chatId))?.pages[0]?.messages[0]?.id;
}

/** A message the person sent, or one that arrived: into its room's messages and its room's preview. */
export function addMessageToCache(queryClient: QueryClient, message: Message): void {
  updatePages(queryClient, message.chatId, (pages) => {
    if (pages.some((page) => page.messages.some(({ id }) => id === message.id))) return pages;
    return pages.map((page, index) =>
      index === 0 ? { ...page, messages: [...page.messages, message].sort((a, b) => b.id - a.id) } : page,
    );
  });

  queryClient.setQueryData<ChatRoomSummary[]>(chatKeys.list(), (rooms) => {
    if (!rooms) return undefined;
    // Ids grow with time, so an id that is not above the preview's is not newer than it.
    return sortRooms(
      rooms.map((room) =>
        room.id === message.chatId && (room.lastMessage?.id ?? 0) < message.id
          ? { ...room, lastMessage: previewOf(message) }
          : room,
      ),
    );
  });
}

/**
 * A message that arrived through the socket: `addMessageToCache`, and when it is somebody else's and
 * newer than the room's preview, one more unread message in the list. It is judged by the preview's id,
 * so a message that arrives twice (or that this tab sent itself, whose answer set the preview) counts once.
 * Answers 'unknown_room' when the room list is loaded and the room is not in it (a room the person was
 * just added to): the caller asks the server for the list.
 */
export function addIncomingMessageToCache(
  queryClient: QueryClient,
  message: Message,
  userId: number,
): 'applied' | 'unknown_room' {
  const rooms = queryClient.getQueryData<ChatRoomSummary[]>(chatKeys.list());
  const room = rooms?.find(({ id }) => id === message.chatId);
  const isNewerThanPreview = (room?.lastMessage?.id ?? 0) < message.id;

  addMessageToCache(queryClient, message);

  if (room && isNewerThanPreview && message.senderId !== userId) {
    queryClient.setQueryData<ChatRoomSummary[]>(chatKeys.list(), (current) =>
      current?.map((each) => (each.id === message.chatId ? { ...each, unreadCount: each.unreadCount + 1 } : each)),
    );
  }
  return rooms && !room ? 'unknown_room' : 'applied';
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
 * loaded (too many arrived at once, or the tab slept), or when nothing is loaded and there is more
 * behind the page: adding them would leave a hole in the conversation. The caller then catches up
 * from the newest loaded message with the `after` cursor, or loads the messages again when there is
 * none to start from.
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
  if (page.hasMore && oldestInPage && (!newestLoaded || oldestInPage.id > newestLoaded.id)) return 'gap';

  const loaded = new Set(data.pages.flatMap((loadedPage) => loadedPage.messages.map(({ id }) => id)));
  for (const message of [...page.messages].reverse()) {
    if (loaded.has(message.id)) replaceMessageInCache(queryClient, message);
    else addMessageToCache(queryClient, message);
  }
  return 'merged';
}

/**
 * An edit, from the answer of PATCH or from the socket: the message in its place, and the room's preview
 * when it was the preview. True when the loaded messages could not say what the preview is now and the
 * room list was asked for instead.
 */
export function applyEditedMessage(queryClient: QueryClient, message: Message): boolean {
  replaceMessageInCache(queryClient, message);
  if (refreshPreviewAfterChange(queryClient, message.chatId, message.id) !== 'unknown') return false;
  void queryClient.invalidateQueries({ queryKey: chatKeys.list() });
  return true;
}

/**
 * A delete, from the answer of DELETE or from the socket: the message made a deleted one, and the room's
 * preview when it was the preview. If it was, the room falls back to the message before it: the loaded ones
 * say which, unless there are none to say, and then the room list is asked for (the answer is true).
 */
export function applyDeletedMessage(
  queryClient: QueryClient,
  chatId: number,
  messageId: number,
  deletedAt: string,
): boolean {
  markMessageDeletedInCache(queryClient, chatId, messageId, deletedAt);
  if (refreshPreviewAfterChange(queryClient, chatId, messageId) !== 'unknown') return false;
  void queryClient.invalidateQueries({ queryKey: chatKeys.list() });
  return true;
}

/** DELETE answers 204 with no message, so the cache makes the deleted one: no content and a `deletedAt`. */
export function markMessageDeletedInCache(
  queryClient: QueryClient,
  chatId: number,
  messageId: number,
  deletedAt: string,
): void {
  updatePages(queryClient, chatId, (pages) =>
    changeMessage(pages, messageId, (message) =>
      message.deletedAt ? message : { ...message, content: '', deletedAt },
    ),
  );
}

/**
 * Brings the room's preview in line with its loaded messages after one of them was edited or deleted.
 * The preview is the room's newest message that is not deleted, and it has an id, so the cache can
 * tell whether the change touched it: when it did, the new preview is the newest loaded message that
 * is not deleted (the same message with its new text, or the one before a deleted one), and the room
 * is placed in the list again. Answers 'unknown', and changes nothing, when the loaded messages
 * cannot say what the preview is now: they are not loaded, or the newest ones are all deleted with
 * older ones behind them. The caller then asks the server for the room list.
 */
export function refreshPreviewAfterChange(
  queryClient: QueryClient,
  chatId: number,
  messageId: number,
): 'unchanged' | 'updated' | 'unknown' {
  const room = queryClient.getQueryData<ChatRoomSummary[]>(chatKeys.list())?.find(({ id }) => id === chatId);
  if (room?.lastMessage?.id !== messageId) return 'unchanged';

  const data = queryClient.getQueryData<MessagePages>(chatKeys.messages(chatId));
  if (!data) return 'unknown';
  const newest = data.pages.flatMap((page) => page.messages).find((message) => message.deletedAt === null);
  const everythingIsLoaded = data.pages.at(-1)?.hasMore === false;
  if (!newest && !everythingIsLoaded) return 'unknown';

  queryClient.setQueryData<ChatRoomSummary[]>(
    chatKeys.list(),
    (rooms) =>
      rooms &&
      sortRooms(
        rooms.map((each) => (each.id === chatId ? { ...each, lastMessage: newest ? previewOf(newest) : null } : each)),
      ),
  );
  return 'updated';
}

export function markRoomReadInCache(queryClient: QueryClient, chatId: number): void {
  queryClient.setQueryData<ChatRoomSummary[]>(chatKeys.list(), (rooms) =>
    rooms?.map((room) => (room.id === chatId && room.unreadCount !== 0 ? { ...room, unreadCount: 0 } : room)),
  );
}

/**
 * The person's own marker moved, in another tab: the room has nothing unread here either when the
 * marker reached its preview. Answers 'unknown', and changes nothing, when it did not: what is left
 * unread is for the server to count, and the caller asks for the room list.
 */
export function markRoomReadUpToInCache(
  queryClient: QueryClient,
  chatId: number,
  lastReadMessageId: number,
): 'applied' | 'unknown' {
  const room = queryClient.getQueryData<ChatRoomSummary[]>(chatKeys.list())?.find(({ id }) => id === chatId);
  if (!room || room.unreadCount === 0) return 'applied';
  if (room.lastMessage !== null && lastReadMessageId < room.lastMessage.id) return 'unknown';

  markRoomReadInCache(queryClient, chatId);
  return 'applied';
}

/** Somebody else's marker moved: into the member list, if it is loaded. Never backwards. */
export function setMemberReadMarkerInCache(
  queryClient: QueryClient,
  chatId: number,
  userId: number,
  lastReadMessageId: number,
): void {
  queryClient.setQueryData<Member[]>(chatKeys.members(chatId), (members) =>
    members?.map((each) =>
      each.member.id === userId && (each.lastReadMessageId ?? 0) < lastReadMessageId
        ? { ...each, lastReadMessageId }
        : each,
    ),
  );
}

/** The order GET /api/chat/:chatid/member uses: admins first, then by name, case and accents ignored. */
export function sortMembers(members: Member[]): Member[] {
  const roleRank = (member: Member) => (member.role === 'admin' ? 0 : 1);
  return [...members].sort(
    (a, b) =>
      roleRank(a) - roleRank(b) ||
      a.member.name.localeCompare(b.member.name, undefined, { sensitivity: 'base' }) ||
      a.member.id - b.member.id,
  );
}

/** People the server added: into the member list if it is loaded (one already there is replaced, not doubled). */
export function addMembersToCache(queryClient: QueryClient, chatId: number, added: Member[]): void {
  queryClient.setQueryData<Member[]>(chatKeys.members(chatId), (members) => {
    if (!members) return undefined;
    const addedIds = new Set(added.map(({ member }) => member.id));
    return sortMembers([...members.filter(({ member }) => !addedIds.has(member.id)), ...added]);
  });
}

/** A member as PATCH answered with it (a new role), the list sorted again. */
export function replaceMemberInCache(queryClient: QueryClient, member: Member): void {
  queryClient.setQueryData<Member[]>(
    chatKeys.members(member.chatId),
    (members) => members && sortMembers(members.map((each) => (each.member.id === member.member.id ? member : each))),
  );
}

export function removeMemberFromCache(queryClient: QueryClient, chatId: number, userId: number): void {
  queryClient.setQueryData<Member[]>(chatKeys.members(chatId), (members) =>
    members?.filter(({ member }) => member.id !== userId),
  );
}

/** A room's new name and avatar into the room list, from the answer of PATCH /api/chat/:chatid or from the socket. */
export function updateRoomInCache(
  queryClient: QueryClient,
  room: Pick<ChatRoomSummary, 'id' | 'name' | 'avatarUrl'>,
): void {
  queryClient.setQueryData<ChatRoomSummary[]>(chatKeys.list(), (rooms) =>
    rooms?.map((each) => (each.id === room.id ? { ...each, name: room.name, avatarUrl: room.avatarUrl } : each)),
  );
}

/** A room the person left or deleted: out of the list, and nothing of it is kept (its messages and members would be stale and unreachable). */
export function removeRoomFromCache(queryClient: QueryClient, chatId: number): void {
  queryClient.setQueryData<ChatRoomSummary[]>(chatKeys.list(), (rooms) => rooms?.filter(({ id }) => id !== chatId));
  queryClient.removeQueries({ queryKey: chatKeys.messages(chatId) });
  queryClient.removeQueries({ queryKey: chatKeys.members(chatId) });
}
