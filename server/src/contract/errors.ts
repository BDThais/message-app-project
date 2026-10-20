// Every 4xx and 5xx answers with `{ error: string }`. The few errors that carry one more key
// extend it; they are added here as the endpoints that send them are typed.

export interface ApiErrorBody {
  error: string;
}

/** The 409 of DELETE /api/account/me: the group rooms the user is the only admin of. */
export interface DeleteAccountConflictBody extends ApiErrorBody {
  chatIds: number[];
}
