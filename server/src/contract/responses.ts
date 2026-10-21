// The JSON bodies of successful responses, named after what they carry. An endpoint that answers
// 204 has no body and no type here. The account and chat room endpoints are typed so far.
// POST /api/chat has no envelope: its body is a `CreatedChatRoom` itself (see types.ts).

import type { ChatRoomCore, ChatRoomDetail, ChatRoomSummary, Member, Message, User } from './types';

/** POST /api/account/signup (201) and POST /api/account/password/reset-request (202). */
export interface MessageResponse {
  message: string;
}

/** POST /api/account/login and PATCH /api/account/me. */
export interface UserResponse {
  user: User;
}

/** GET /api/account/me: `user` is null when nobody is signed in (still a 200). */
export interface MeResponse {
  user: User | null;
}

/** POST /api/account/logout. */
export interface LogoutResponse {
  user: null;
}

/** GET /api/chat. */
export interface ChatRoomListResponse {
  chatRooms: ChatRoomSummary[];
}

/** GET /api/chat/:chatid. */
export interface ChatRoomDetailResponse {
  chatRoom: ChatRoomDetail;
}

/** PATCH /api/chat/:chatid. */
export interface ChatRoomCoreResponse {
  chatRoom: ChatRoomCore;
}

/** GET /api/chat/:chatid/member. */
export interface MemberListResponse {
  members: Member[];
}

/** POST /api/chat/:chatid/member (201 when someone was added, 200 when everyone already was a member). */
export interface AddMembersResponse {
  addedMembers: Member[];
  alreadyMemberIds: number[];
}

/** PATCH /api/chat/:chatid/member/:userid. */
export interface MemberResponse {
  member: Member;
}

/** POST /api/chat/:chatid/message and PATCH /api/chat/:chatid/message/:message_id. */
export interface ChatMessageResponse {
  message: Message;
}

/** GET /api/chat/:chatid/message: newest first; `hasMore` is true when older messages remain. */
export interface MessageListResponse {
  messages: Message[];
  hasMore: boolean;
}

/** PUT /api/chat/:chatid/read: the marker as it stands after the call. */
export interface MarkReadResponse {
  lastReadMessageId: number;
}
