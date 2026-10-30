import { api } from '@/lib/http';
import type { EditMessageBody, GetMessagesQuery, MarkReadBody, SendMessageBody } from '@contract/requests';
import type {
  ChatMessageResponse,
  ChatRoomListResponse,
  MarkReadResponse,
  MessageListResponse,
} from '@contract/responses';
import type { ChatRoomSummary, Message } from './types';

// One function per endpoint; no React and no caching in here (see queries.ts and cache.ts for that).

export async function getChatRooms(signal?: AbortSignal): Promise<ChatRoomSummary[]> {
  const { chatRooms } = await api.get<ChatRoomListResponse>('/chat', { signal });
  return chatRooms;
}

/**
 * A page of messages, always newest first. With no cursor it is the newest page; `before` (the id of the
 * oldest message already loaded) pages back in time; `after` (the id of the newest one loaded) pages
 * forward, to catch up: the oldest messages above that id, `hasMore` saying that newer ones remain.
 */
export function getMessages(
  chatId: number,
  cursor: { before?: number; after?: number },
  signal?: AbortSignal,
): Promise<MessageListResponse> {
  const params = {
    ...(cursor.before !== undefined && { before: String(cursor.before) }),
    ...(cursor.after !== undefined && { after: String(cursor.after) }),
  } satisfies GetMessagesQuery;
  const query = Object.keys(params).length === 0 ? '' : `?${new URLSearchParams(params)}`;
  return api.get<MessageListResponse>(`/chat/${chatId}/message${query}`, { signal });
}

export async function sendMessage(chatId: number, content: string): Promise<Message> {
  const { message } = await api.post<ChatMessageResponse>(`/chat/${chatId}/message`, { content } satisfies SendMessageBody);
  return message;
}

export async function editMessage(chatId: number, messageId: number, content: string): Promise<Message> {
  const { message } = await api.patch<ChatMessageResponse>(
    `/chat/${chatId}/message/${messageId}`,
    { content } satisfies EditMessageBody,
  );
  return message;
}

/** A soft delete: the message stays in the list as a placeholder. The answer is 204, with no message in it. */
export async function deleteMessage(chatId: number, messageId: number): Promise<void> {
  await api.delete<void>(`/chat/${chatId}/message/${messageId}`);
}

/** Moves the requester's read marker up to `messageId`; resolves to where the marker is afterwards. */
export async function markRead(chatId: number, messageId: number): Promise<number> {
  const { lastReadMessageId } = await api.put<MarkReadResponse>(
    `/chat/${chatId}/read`,
    { message_id: messageId } satisfies MarkReadBody,
  );
  return lastReadMessageId;
}
