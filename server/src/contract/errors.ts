// Every 4xx and 5xx answers with `{ error: string }`. The few errors that carry one more key
// extend it.

export interface ApiErrorBody {
  error: string;
}

/** The 409 of DELETE /api/account/me: the group rooms the user is the only admin of. */
export interface DeleteAccountConflictBody extends ApiErrorBody {
  chatIds: number[];
}

/** The 409 of POST /api/friend/requests when the other user already sent a request: `requestId` is theirs, to accept. */
export interface FriendRequestConflictBody extends ApiErrorBody {
  requestId: number;
}
