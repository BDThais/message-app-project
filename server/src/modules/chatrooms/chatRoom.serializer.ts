import type { ChatRoomDetail, ChatRoomSummary, CreatedChatRoom, Member, Message, Role } from '../../contract/types';
import type { ChatRoomSummaryData } from './chatRoom.service';
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

/** What GET /api/chat/:chatid and PATCH /api/chat/:chatid return: the summary plus the requester's role. */
export function toChatRoomDetail(room: ChatRoomSummaryData, role: Role): ChatRoomDetail {
  return { ...toChatRoomSummary(room), role };
}

/** What POST /api/chat returns. The members are already shaped by `memberResponseArgs` (chatMember.service.ts). */
export function toCreatedChatRoom(room: ChatRoomSummaryData, role: Role, members: Member[]): CreatedChatRoom {
  return { ...toChatRoomDetail(room, role), members };
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
