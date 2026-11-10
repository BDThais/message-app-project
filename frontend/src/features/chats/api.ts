import { api } from '@/lib/http';
import type {
  AddMembersBody,
  ChangeMemberRoleBody,
  CreateChatRoomBody,
  EditMessageBody,
  GetMessagesQuery,
  MarkReadBody,
  SendMessageBody,
  UpdateChatRoomBody,
} from '@contract/requests';
import type {
  AddMembersResponse,
  ChatMessageResponse,
  ChatRoomDetailResponse,
  ChatRoomListResponse,
  CreatedChatRoomResponse,
  MarkReadResponse,
  MemberListResponse,
  MemberResponse,
  MessageListResponse,
} from '@contract/responses';
import type { ChatRoomDetail, ChatRoomSummary, CreatedChatRoom, Member, Message, Role } from './types';

// One function per endpoint; no React and no caching in here (see queries.ts and cache.ts for that).

export async function getChatRooms(signal?: AbortSignal): Promise<ChatRoomSummary[]> {
  const { chatRooms } = await api.get<ChatRoomListResponse>('/chat', { signal });
  return chatRooms;
}

/** The direct room with a friend: a new one (201) or the one that already exists (200). Two people who are not friends (any more) get a 403. */
export async function createDirectChatRoom(userId: number): Promise<CreatedChatRoom> {
  const { chatRoom } = await api.post<CreatedChatRoomResponse>('/chat', {
    type: 'direct',
    member_ids: [userId],
  } satisfies CreateChatRoomBody);
  return chatRoom;
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
  const { message } = await api.post<ChatMessageResponse>(`/chat/${chatId}/message`, {
    content,
  } satisfies SendMessageBody);
  return message;
}

export async function editMessage(chatId: number, messageId: number, content: string): Promise<Message> {
  const { message } = await api.patch<ChatMessageResponse>(`/chat/${chatId}/message/${messageId}`, {
    content,
  } satisfies EditMessageBody);
  return message;
}

/** A soft delete: the message stays in the list as a placeholder. The answer is 204, with no message in it. */
export async function deleteMessage(chatId: number, messageId: number): Promise<void> {
  await api.delete<void>(`/chat/${chatId}/message/${messageId}`);
}

/** Moves the requester's read marker up to `messageId`; resolves to where the marker is afterwards. */
export async function markRead(chatId: number, messageId: number): Promise<number> {
  const { lastReadMessageId } = await api.put<MarkReadResponse>(`/chat/${chatId}/read`, {
    message_id: messageId,
  } satisfies MarkReadBody);
  return lastReadMessageId;
}

/** What a new group room takes: `name` and `avatarUrl` can be left out, and `memberIds` can be empty (the creator is then alone in it). */
export interface CreateGroupInput {
  name?: string;
  avatarUrl?: string;
  memberIds: number[];
}

/** Every one of `memberIds` has to be a friend: one who is not refuses the whole request with a 403, and no room is made. */
export async function createGroupChatRoom({ name, avatarUrl, memberIds }: CreateGroupInput): Promise<CreatedChatRoom> {
  const body: CreateChatRoomBody = { type: 'group', member_ids: memberIds };
  if (name !== undefined) body.name = name;
  if (avatarUrl !== undefined) body.avatar_url = avatarUrl;
  const { chatRoom } = await api.post<CreatedChatRoomResponse>('/chat', body);
  return chatRoom;
}

/** What PATCH /api/chat/:chatid can change: `avatarUrl: null` clears the avatar, and a field that is left out stays. */
export interface UpdateRoomInput {
  name?: string;
  avatarUrl?: string | null;
}

export async function updateChatRoom(chatId: number, { name, avatarUrl }: UpdateRoomInput): Promise<ChatRoomDetail> {
  const body: UpdateChatRoomBody = {};
  if (name !== undefined) body.name = name;
  if (avatarUrl !== undefined) body.avatar_url = avatarUrl;
  const { chatRoom } = await api.patch<ChatRoomDetailResponse>(`/chat/${chatId}`, body);
  return chatRoom;
}

/** Deletes the room with its messages and memberships (admins of group rooms only). */
export async function deleteChatRoom(chatId: number): Promise<void> {
  await api.delete<void>(`/chat/${chatId}`);
}

/** Admins first, then by name: the order the server answers in. */
export async function getMembers(chatId: number, signal?: AbortSignal): Promise<Member[]> {
  const { members } = await api.get<MemberListResponse>(`/chat/${chatId}/member`, { signal });
  return members;
}

/** Users who are already members are skipped by the server and come back in `alreadyMemberIds`. */
export function addMembers(chatId: number, memberIds: number[]): Promise<AddMembersResponse> {
  return api.post<AddMembersResponse>(`/chat/${chatId}/member`, { member_ids: memberIds } satisfies AddMembersBody);
}

/** Removes a member, or leaves the room when `userId` is the person's own id. */
export async function removeMember(chatId: number, userId: number): Promise<void> {
  await api.delete<void>(`/chat/${chatId}/member/${userId}`);
}

export async function changeMemberRole(chatId: number, userId: number, role: Role): Promise<Member> {
  const { member } = await api.patch<MemberResponse>(`/chat/${chatId}/member/${userId}`, {
    role,
  } satisfies ChangeMemberRoleBody);
  return member;
}
