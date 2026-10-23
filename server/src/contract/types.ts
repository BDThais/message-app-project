// The shapes the API puts on the wire: one place for the server and the frontend (the frontend
// imports this folder as `@contract/*`, with `import type`). The rules for this folder are in
// "API contract" in backend.doc.md: nothing here imports anything from outside the folder, and
// every value is JSON (a timestamp is an ISO 8601 string here, never a Date).
//
// Every shape here is checked by the compiler on the server: the controllers answer with them. The
// frontend checks the account ones (it has no chat or friends code yet).

export type Role = 'admin' | 'member';

export type RoomType = 'direct' | 'group';

/** Your own account: login, GET /api/account/me, PATCH /api/account/me. */
export interface User {
  id: number;
  name: string;
  email: string;
  tel: string;
  avatarUrl: string | null;
  emailVerified: boolean;
}

/** Any other user. Never has an email or a tel. */
export interface PublicUser {
  id: number;
  name: string;
  avatarUrl: string | null;
}

/** GET /api/chat, one entry per room. */
export interface ChatRoomSummary {
  id: number;
  type: RoomType;
  /** Direct room: the other member's name (null once they are gone). Group room: its own name, may be null. */
  name: string | null;
  /** Direct room: the other member's avatar. */
  avatarUrl: string | null;
  createdAt: string;
  /** The newest message that is not deleted; no id, no sender. */
  lastMessage: { content: string; createdAt: string } | null;
  unreadCount: number;
}

/** One room as its requester sees it: GET /api/chat/:chatid, and what PATCH /api/chat/:chatid returns. */
export interface ChatRoomDetail extends ChatRoomSummary {
  /** The requester's own role. */
  role: Role;
}

/** What POST /api/chat returns: the room as its creator sees it, with its members, so the client can show it without a second request. */
export interface CreatedChatRoom extends ChatRoomDetail {
  members: Member[];
}

/** Members of a room: GET/POST/PATCH under /api/chat/:chatid/member, and `members` of POST /api/chat. */
export interface Member {
  chatId: number;
  role: Role;
  lastReadMessageId: number | null;
  member: PublicUser;
}

export interface Message {
  id: number;
  chatId: number;
  /** Null when the sender has deleted their account. */
  senderId: number | null;
  /** '' once the message is deleted. */
  content: string;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  /** Null together with senderId. */
  sender: PublicUser | null;
}

/** GET /api/friend/requests, POST /api/friend/requests. `user` is always the other party. */
export interface FriendRequest {
  id: number;
  createdAt: string;
  user: PublicUser;
}

export type Relationship = 'self' | 'friend' | 'request_sent' | 'request_received' | 'none';

/** GET /api/friend/search/:tel. `requestId` only for the two request states. */
export interface SearchResult extends PublicUser {
  relationship: Relationship;
  requestId?: number;
}
