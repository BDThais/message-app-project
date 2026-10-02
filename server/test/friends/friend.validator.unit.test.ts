import { describe, expect, it } from 'vitest';
import { MAX_INT32 } from '../../src/lib/constants';
import {
  validateGetFriendRequestsQuery,
  validateRequestIdParam,
  validateSendFriendRequestBody,
  validateTelParam,
  validateUserIdParam,
} from '../../src/modules/friends/friend.validator';

// Pure function, so no database and no HTTP: the endpoint test only needs one
// bad-input case to prove the validator is wired in, and every other bad input
// lives here as one line in a table.

describe('validateTelParam', () => {
  it.each([
    ['a Vietnamese number', '+84912345678'],
    ['a US number', '+14155552671'],
  ])('accepts %s', (_label, tel) => {
    expect(validateTelParam(tel)).toEqual({ valid: true, data: { tel } });
  });

  // '+1 415 555 2671', '+1 (415) 555-2671', '+14155552671x123', trailing spaces
  // and non-ASCII digits all pass isValidPhoneNumber (the rule signup uses) but
  // are not canonical E.164, so they are rejected here on purpose.
  it.each([
    ['a number without the leading +', '84912345678'],
    ['a national number with no country code', '4155552671'],
    ['spaces inside the number', '+1 415 555 2671'],
    ['parentheses and dashes', '+1 (415) 555-2671'],
    ['an extension', '+14155552671x123'],
    ['non-ASCII digits', '+٨٤٩١٢٣٤٥٦٧٨'],
    ['a full-width plus sign', '＋14155552671'],
    ['leading whitespace', ' +14155552671'],
    ['trailing whitespace', '+14155552671 '],
    ['a trailing newline', '+14155552671\n'],
    ['a number too short for its country', '+1415555267'],
    ['a country code starting with 0', '+0123456789'],
    ['more than 15 digits', '+1234567890123456'],
    ['a letter in the number', '+1415555267a'],
    ['no digits at all', 'abc'],
    ['only a plus sign', '+'],
    ['an empty string', ''],
  ])('rejects %s', (_label, tel) => {
    expect(validateTelParam(tel)).toEqual({
      valid: false,
      message: "'tel' must be a valid phone number in E.164 format, for example +84912345678",
    });
  });

  it('rejects a value that is not a string', () => {
    expect(validateTelParam(undefined)).toMatchObject({ valid: false });
    expect(validateTelParam(14155552671)).toMatchObject({ valid: false });
  });
});

describe('validateSendFriendRequestBody', () => {
  const requesterId = 1;

  it.each([
    ['an ordinary ID', 2],
    ['the smallest ID other than the requester\'s', 2],
    ['the largest ID the database can hold', MAX_INT32],
  ])('accepts %s', (_label, receiverId) => {
    expect(validateSendFriendRequestBody({ receiver_id: receiverId }, requesterId)).toEqual({
      valid: true,
      data: { receiverId },
    });
  });

  it.each([
    ['no body at all', undefined],
    ['a body that is not an object', 'receiver_id=2'],
    ['a missing receiver_id', {}],
    ['a null receiver_id', { receiver_id: null }],
    ['a receiver_id given as a string', { receiver_id: '2' }],
    ['a receiver_id given as an array', { receiver_id: [2] }],
    ['a fractional receiver_id', { receiver_id: 2.5 }],
    ['zero', { receiver_id: 0 }],
    ['a negative ID', { receiver_id: -2 }],
    ['an ID past the database integer range', { receiver_id: MAX_INT32 + 1 }],
    ['a receiver_id that is not finite', { receiver_id: Infinity }],
  ])('rejects %s', (_label, body) => {
    expect(validateSendFriendRequestBody(body, requesterId)).toEqual({
      valid: false,
      message: "'receiver_id' must be a valid user ID",
    });
  });

  it("rejects the requester's own ID", () => {
    expect(validateSendFriendRequestBody({ receiver_id: requesterId }, requesterId)).toEqual({
      valid: false,
      message: 'You cannot send a friend request to yourself',
    });
  });
});

describe('validateGetFriendRequestsQuery', () => {
  it.each([
    ['no query parameters', {}, 'incoming'],
    ['no query object at all', undefined, 'incoming'],
    ['incoming', { direction: 'incoming' }, 'incoming'],
    ['outgoing', { direction: 'outgoing' }, 'outgoing'],
    ['other parameters, which are ignored', { direction: 'outgoing', page: '2' }, 'outgoing'],
  ])('accepts %s', (_label, query, direction) => {
    expect(validateGetFriendRequestsQuery(query)).toEqual({ valid: true, data: { direction } });
  });

  it.each([
    ['an unknown value', { direction: 'all' }],
    ['an empty value', { direction: '' }],
    ['a different case', { direction: 'Incoming' }],
    ['surrounding whitespace', { direction: ' outgoing' }],
    ['a repeated parameter (parsed into an array)', { direction: ['incoming', 'outgoing'] }],
    ['a single-item array', { direction: ['incoming'] }],
    ['a nested object', { direction: { value: 'incoming' } }],
    ['a value that is not a string', { direction: 1 }],
    ['null', { direction: null }],
  ])('rejects %s', (_label, query) => {
    expect(validateGetFriendRequestsQuery(query)).toEqual({
      valid: false,
      message: "'direction' must be 'incoming' or 'outgoing'",
    });
  });
});

describe('validateRequestIdParam', () => {
  it.each([
    ['an ordinary ID', '7', 7],
    ['the smallest ID', '1', 1],
    ['the largest ID the database can hold', String(MAX_INT32), MAX_INT32],
  ])('accepts %s', (_label, raw, requestId) => {
    expect(validateRequestIdParam(raw)).toEqual({ valid: true, data: { requestId } });
  });

  it.each([
    ['zero', '0'],
    ['a negative ID', '-7'],
    ['an ID past the database integer range', String(MAX_INT32 + 1)],
    ['a fractional ID', '7.5'],
    ['exponent notation', '1e3'],
    ['a hexadecimal number', '0x10'],
    ['a plus sign', '+7'],
    ['surrounding whitespace', ' 7 '],
    ['letters', 'abc'],
    ['an empty string', ''],
    ['a value that is not a string', 7],
    ['no value at all', undefined],
  ])('rejects %s', (_label, raw) => {
    expect(validateRequestIdParam(raw)).toEqual({
      valid: false,
      message: 'Invalid friend request id',
    });
  });
});

describe('validateUserIdParam', () => {
  it.each([
    ['an ordinary ID', '7', 7],
    ['the smallest ID', '1', 1],
    ['the largest ID the database can hold', String(MAX_INT32), MAX_INT32],
  ])('accepts %s', (_label, raw, userId) => {
    expect(validateUserIdParam(raw)).toEqual({ valid: true, data: { userId } });
  });

  it.each([
    ['zero', '0'],
    ['a negative ID', '-7'],
    ['an ID past the database integer range', String(MAX_INT32 + 1)],
    ['a fractional ID', '7.5'],
    ['exponent notation', '1e3'],
    ['a hexadecimal number', '0x10'],
    ['a plus sign', '+7'],
    ['surrounding whitespace', ' 7 '],
    ['letters', 'abc'],
    ['an empty string', ''],
    ['a value that is not a string', 7],
    ['no value at all', undefined],
  ])('rejects %s', (_label, raw) => {
    expect(validateUserIdParam(raw)).toEqual({
      valid: false,
      message: 'Invalid user id',
    });
  });
});
