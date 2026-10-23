import type { FriendRequest } from '../../contract/types';
import type { FriendRequestData } from './friend.service';

// From what the friend service returns (a request holding a `Date`) to the contract's plain JSON.
// Every field is named, so a column added to the user or the request later is not sent until the
// contract has it.

export function toFriendRequest(request: FriendRequestData): FriendRequest {
  return {
    id: request.id,
    createdAt: request.createdAt.toISOString(),
    user: { id: request.user.id, name: request.user.name, avatarUrl: request.user.avatarUrl },
  };
}
