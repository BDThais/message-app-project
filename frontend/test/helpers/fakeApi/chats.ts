import type {
  ChatMessageResponse,
  ChatRoomListResponse,
  MarkReadResponse,
  MessageListResponse,
} from '@contract/responses';
import type { ChatRoomSummary } from '@contract/types';
import { json, noContent } from './responses';
import type { Body, FakeRoom, FakeServer } from './state';

// /api/chat, /api/chat/:id/message, /api/chat/:id/message/:messageId and /api/chat/:id/read, with the
// query string kept apart.
const ROUTE = /^(GET|POST|PATCH|PUT|DELETE) \/api\/chat(?:\/(\d+)(?:\/(message|read)(?:\/(\d+))?)?)?(?:\?(.*))?$/;

const DEFAULT_PAGE_SIZE = 50;

function summaryOf(room: FakeRoom, state: FakeServer): ChatRoomSummary {
  const mine = state.session?.id;
  const inRoom = state.messages.filter((message) => message.chatId === room.id);
  const last = inRoom.filter((message) => message.deletedAt === null).at(-1);
  return {
    id: room.id,
    type: room.type,
    name: room.name,
    avatarUrl: room.avatarUrl,
    createdAt: room.createdAt,
    lastMessage: last
      ? { id: last.id, senderId: last.senderId, content: last.content, createdAt: last.createdAt }
      : null,
    // Like the server: above the read marker, not the requester's own, not deleted (a deleted account's still counts).
    unreadCount: inRoom.filter(
      (message) => message.id > (room.lastReadMessageId ?? 0) && message.senderId !== mine && message.deletedAt === null,
    ).length,
  };
}

/** The chat endpoints; the rules follow api.doc.md. Returns `undefined` for a request that is not one of them. */
export function chatEndpoints(request: string, body: Body, state: FakeServer): Response | undefined {
  const match = ROUTE.exec(request);
  if (!match) return undefined;
  const [, method, chatIdText, part, messageIdText, query] = match;
  if (!state.session) return json({ error: 'Unauthorized Access' }, 401);

  if (chatIdText === undefined) {
    if (method !== 'GET') return undefined;
    const time = (summary: ChatRoomSummary) => summary.lastMessage?.createdAt ?? summary.createdAt;
    const chatRooms = state.rooms
      .map((room) => summaryOf(room, state))
      .sort((a, b) => (time(a) === time(b) ? b.id - a.id : time(a) < time(b) ? 1 : -1));
    return json({ chatRooms } satisfies ChatRoomListResponse);
  }

  const chatId = Number(chatIdText);
  const room = state.rooms.find(({ id }) => id === chatId);
  if (!room) return json({ error: 'Chat room not found' }, 404);
  const inRoom = state.messages.filter((message) => message.chatId === chatId);

  if (part === 'read' && method === 'PUT') {
    const target = inRoom.find(({ id }) => id === Number(body?.message_id));
    if (!target) return json({ error: 'Message not found in this chat room' }, 404);
    room.lastReadMessageId = Math.max(room.lastReadMessageId ?? 0, target.id); // the marker only moves forward
    return json({ lastReadMessageId: room.lastReadMessageId } satisfies MarkReadResponse);
  }

  if (part !== 'message') return undefined;
  if (method !== 'GET' && state.messageWriteError) return json({ error: state.messageWriteError }, 400);

  if (messageIdText === undefined) {
    if (method === 'GET') {
      const params = new URLSearchParams(query);
      const before = params.has('before') ? Number(params.get('before')) : Infinity;
      const limit = params.has('limit') ? Number(params.get('limit')) : DEFAULT_PAGE_SIZE;
      const older = inRoom.filter(({ id }) => id < before).reverse(); // newest first
      return json({ messages: older.slice(0, limit), hasMore: older.length > limit } satisfies MessageListResponse);
    }
    if (method === 'POST') {
      const content = String(body?.content ?? '').trim();
      if (content === '') return json({ error: 'content must be a non-empty string' }, 400);
      const { id, name, avatarUrl } = state.session;
      const message = state.addMessage({ chatId, sender: { id, name, avatarUrl }, content });
      return json({ message } satisfies ChatMessageResponse, 201);
    }
    return undefined;
  }

  const message = inRoom.find(({ id }) => id === Number(messageIdText));
  if (!message || message.deletedAt !== null) return json({ error: 'Message not found in this chat room' }, 404);
  if (method === 'PATCH') {
    if (message.senderId !== state.session.id) return json({ error: 'You can only edit your own messages' }, 403);
    const content = String(body?.content ?? '').trim();
    if (content === '') return json({ error: 'content must be a non-empty string' }, 400);
    if (content !== message.content) {
      message.content = content;
      message.editedAt = new Date().toISOString();
    }
    return json({ message } satisfies ChatMessageResponse);
  }
  if (method === 'DELETE') {
    if (message.senderId !== state.session.id) return json({ error: 'You can only delete your own messages' }, 403);
    message.content = '';
    message.deletedAt = new Date().toISOString();
    return noContent();
  }
  return undefined;
}
