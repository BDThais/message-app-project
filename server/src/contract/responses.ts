// The JSON bodies of successful responses, named after what they carry. An endpoint that answers
// 204 has no body and no type here.

import type {
  ChatRoomDetail, ChatRoomSummary, CreatedChatRoom, FriendRequest, Member, Message, PublicUser, SearchResult, User
} from './types';

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

/** GET /api/chat/:chatid and PATCH /api/chat/:chatid. */
export interface ChatRoomDetailResponse {
  chatRoom: ChatRoomDetail;
}

/** POST /api/chat (201 for a new room, 200 when an existing direct room is reused). */
export interface CreatedChatRoomResponse {
  chatRoom: CreatedChatRoom;
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

/** GET /api/friend/search/:tel: `user` is null when nobody has that number (still a 200). */
export interface SearchUserResponse {
  user: SearchResult | null;
}

/** POST /api/friend/requests (201). */
export interface FriendRequestResponse {
  request: FriendRequest;
}

/** GET /api/friend/requests. */
export interface FriendRequestListResponse {
  requests: FriendRequest[];
}

/** POST /api/friend/requests/:id/accept (201): the new friend. */
export interface AcceptedFriendResponse {
  friend: PublicUser;
}

/** GET /api/friend. */
export interface FriendListResponse {
  friends: PublicUser[];
}
