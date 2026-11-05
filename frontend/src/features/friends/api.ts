import { api } from '@/lib/http';
import type { GetFriendRequestsQuery, SendFriendRequestBody } from '@contract/requests';
import type {
  AcceptedFriendResponse,
  FriendListResponse,
  FriendRequestListResponse,
  FriendRequestResponse,
  SearchUserResponse,
} from '@contract/responses';
import type { FriendRequest, FriendRequestDirection, PublicUser, SearchResult } from './types';

// One function per endpoint; no React and no caching in here (see queries.ts and cache.ts for that).

/** The friends, sorted by name. */
export async function getFriends(signal?: AbortSignal): Promise<PublicUser[]> {
  const { friends } = await api.get<FriendListResponse>('/friend', { signal });
  return friends;
}

/** `incoming`: what others sent to the person. `outgoing`: what the person sent and can still cancel. Newest first. */
export async function getFriendRequests(direction: FriendRequestDirection, signal?: AbortSignal): Promise<FriendRequest[]> {
  const params = { direction } satisfies GetFriendRequestsQuery;
  const { requests } = await api.get<FriendRequestListResponse>(`/friend/requests?${new URLSearchParams(params)}`, { signal });
  return requests;
}

/** `tel` must be in the canonical spelling already (see `normalizeTel`). `null` when nobody has that number: still a 200. */
export async function searchUserByTel(tel: string, signal?: AbortSignal): Promise<SearchResult | null> {
  const { user } = await api.get<SearchUserResponse>(`/friend/search/${encodeURIComponent(tel)}`, { signal });
  return user;
}

/** The new request, whose `user` is the receiver. */
export async function sendFriendRequest(receiverId: number): Promise<FriendRequest> {
  const { request } = await api.post<FriendRequestResponse>(
    '/friend/requests',
    { receiver_id: receiverId } satisfies SendFriendRequestBody,
  );
  return request;
}

/** Resolves to the new friend. It does not make a room: that is `createDirectChatRoom`. */
export async function acceptFriendRequest(requestId: number): Promise<PublicUser> {
  const { friend } = await api.post<AcceptedFriendResponse>(`/friend/requests/${requestId}/accept`);
  return friend;
}

/** The receiver rejects with it and the sender cancels with it: one endpoint, and no "rejected" state behind it. */
export async function deleteFriendRequest(requestId: number): Promise<void> {
  await api.delete<void>(`/friend/requests/${requestId}`);
}

/** Takes `userId`, not a request id: the two sides of the friendship go. Existing direct rooms stay. */
export async function unfriend(userId: number): Promise<void> {
  await api.delete<void>(`/friend/${userId}`);
}
