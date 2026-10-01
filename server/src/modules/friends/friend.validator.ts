import { isValidPhoneNumber } from 'libphonenumber-js';
import { MAX_INT32 as MAX_ID } from '../../lib/constants';
import { parseIdParam } from '../../lib/parseIdParam';
import type { FriendRequestDirection } from './friend.service';

// A full E.164 number in its canonical spelling: '+', a country code that
// does not start with 0, and at most 15 digits in total.
const E164_RE = /^\+[1-9]\d{1,14}$/;

type TelParamValidation =
  | { valid: true; data: { tel: string } }
  | { valid: false; message: string };

/**
 * Validates the ':tel' URL param of GET /friend/search/:tel.
 *
 * Two checks, both required:
 * - isValidPhoneNumber with no default country, the same call signup makes
 *   (signup.validator.ts), so the number must carry its country code and be
 *   a real number for that country;
 * - the canonical E.164 spelling. isValidPhoneNumber alone also accepts
 *   '+1 415 555 2671', '+1 (415) 555-2671', '+14155552671 ext. 123' and
 *   non-ASCII digits. The lookup is an exact string match, so accepting
 *   those spellings would answer "nobody found" for a number that is
 *   registered, which is worse than a 400 that says what format to send.
 */
export function validateTelParam(rawTel: unknown): TelParamValidation {
  if (typeof rawTel !== 'string' || !E164_RE.test(rawTel) || !isValidPhoneNumber(rawTel)) {
    return {
      valid: false,
      message: "'tel' must be a valid phone number in E.164 format, for example +84912345678",
    };
  }

  return { valid: true, data: { tel: rawTel } };
}

type SendFriendRequestValidation =
  | { valid: true; data: { receiverId: number } }
  | { valid: false; message: string };

/**
 * Validates the body of POST /friend/requests. `receiver_id` must be a
 * positive integer within the Postgres integer range (the same rule as the
 * IDs in POST /chat's `member_ids`) and must not be the requester's own ID.
 * Whether it refers to an existing user is the service's question, not the
 * validator's.
 */
export function validateSendFriendRequestBody(
  body: unknown,
  requesterId: number
): SendFriendRequestValidation {
  // Express leaves req.body undefined when the request has no JSON body.
  const { receiver_id } = typeof body === 'object' && body !== null
    ? (body as Record<string, unknown>)
    : {};

  if (!Number.isInteger(receiver_id) || (receiver_id as number) < 1 || (receiver_id as number) > MAX_ID) {
    return { valid: false, message: "'receiver_id' must be a valid user ID" };
  }

  if (receiver_id === requesterId) {
    return { valid: false, message: 'You cannot send a friend request to yourself' };
  }

  return { valid: true, data: { receiverId: receiver_id as number } };
}

type GetFriendRequestsQueryValidation =
  | { valid: true; data: { direction: FriendRequestDirection } }
  | { valid: false; message: string };

/**
 * Validates the query string of GET /friend/requests. `direction` is optional
 * and defaults to `incoming` (the inbox); the only other value is `outgoing`.
 * Anything else is a 400, including an empty value (`?direction=`), a
 * different case (`Incoming`) and a repeated parameter, which Express parses
 * into an array. Other query parameters are ignored.
 */
export function validateGetFriendRequestsQuery(query: unknown): GetFriendRequestsQueryValidation {
  const { direction } = typeof query === 'object' && query !== null
    ? (query as Record<string, unknown>)
    : {};

  if (direction === undefined || direction === 'incoming') {
    return { valid: true, data: { direction: 'incoming' } };
  }

  if (direction === 'outgoing') {
    return { valid: true, data: { direction: 'outgoing' } };
  }

  return { valid: false, message: "'direction' must be 'incoming' or 'outgoing'" };
}

type RequestIdParamValidation =
  | { valid: true; data: { requestId: number } }
  | { valid: false; message: string };

/**
 * Validates the ':id' URL param of the /friend/requests/:id routes, which is a
 * *request* ID (PendingFriendRequest.id), not a user ID. Only plain digit
 * strings between 1 and the Postgres integer maximum are accepted (see
 * parseIdParam).
 */
export function validateRequestIdParam(rawRequestId: unknown): RequestIdParamValidation {
  const requestId = parseIdParam(rawRequestId);

  return requestId === null
    ? { valid: false, message: 'Invalid friend request id' }
    : { valid: true, data: { requestId } };
}
