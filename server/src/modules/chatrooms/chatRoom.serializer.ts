import type { ChatRoomCore, ChatRoomSummary, CreatedChatRoom, Message } from '../../contract/types';
import type { ChatRoomSummaryData, ChatRoomWithMembers } from './chatRoom.service';
import type { MessageWithSender } from './message.service';

// From what the services return (Prisma rows and summaries that hold `Date`s) to the shapes of
// contract/types.ts, which are plain JSON. Every field is named here instead of spread, so a column
// added to a table later does not reach a client until someone adds it to the contract.
// `Date.toISOString` gives the string `JSON.stringify` would have written for the same Date.

const iso = (date: Date): string => date.toISOString();
const isoOrNull = (date: Date | null): string | null => (date === null ? null : iso(date));

/** One entry of GET /api/chat, and the room part of GET /api/chat/:chatid. */
export function toChatRoomSummary(room: ChatRoomSummaryData): ChatRoomSummary {
  return {
    id: room.id,
    type: room.type,
    name: room.name,
    avatarUrl: room.avatarUrl,
    createdAt: iso(room.createdAt),
    lastMessage:
      room.lastMessage === null
        ? null
        : { content: room.lastMessage.content, createdAt: iso(room.lastMessage.createdAt) },
    unreadCount: room.unreadCount,
  };
}

/** The room's own columns: what PATCH /api/chat/:chatid returns, and the start of POST /api/chat's body. */
export function toChatRoomCore(room: Omit<ChatRoomCore, 'createdAt'> & { createdAt: Date }): ChatRoomCore {
  return {
    id: room.id,
    type: room.type,
    name: room.name,
    avatarUrl: room.avatarUrl,
    createdAt: iso(room.createdAt),
  };
}

/** What POST /api/chat returns. Its members are already shaped by `memberResponseArgs` (chatMember.service.ts). */
export function toCreatedChatRoom(room: ChatRoomWithMembers): CreatedChatRoom {
  return { ...toChatRoomCore(room), members: room.members };
}

export function toMessage(message: MessageWithSender): Message {
  return {
    id: message.id,
    chatId: message.chatId,
    senderId: message.senderId,
    content: message.content,
    createdAt: iso(message.createdAt),
    editedAt: isoOrNull(message.editedAt),
    deletedAt: isoOrNull(message.deletedAt),
    sender:
      message.sender === null
        ? null
        : { id: message.sender.id, name: message.sender.name, avatarUrl: message.sender.avatarUrl },
  };
}
