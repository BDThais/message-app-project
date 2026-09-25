import { describe, expect, it } from 'vitest';
import {
  validateAddMembersBody,
  validateChangeMemberRoleBody,
  validateChatIdParam,
  validateCreateChatRoomInput,
  validateSendMessageBody,
  validateUpdateChatRoomBody,
  validateUserIdParam,
} from '../../src/modules/chatrooms/chatRoom.validator';

// Pure functions, so no database and no HTTP: the endpoint tests only need one
// bad-input case each to prove the validator is wired in, and every other bad
// input lives here as one line in a table.

describe('validateCreateChatRoomInput', () => {
  const requesterId = 1;

  it('drops the requester and duplicate ids from member_ids', () => {
    const result = validateCreateChatRoomInput(
      { type: 'group', member_ids: [1, 2, 2, 3], name: 'Team' },
      requesterId
    );

    expect(result).toEqual({ valid: true, type: 'group', memberIds: [2, 3], name: 'Team' });
  });

  it('allows a group room with nobody but its creator', () => {
    expect(validateCreateChatRoomInput({ type: 'group' }, requesterId)).toEqual({
      valid: true,
      type: 'group',
      memberIds: [],
    });
  });

  it.each([
    ['a missing type', { member_ids: [2] }, 'type must be "direct" or "group"'],
    ['an unknown type', { type: 'channel' }, 'type must be "direct" or "group"'],
    ['member_ids that are not integers', { type: 'group', member_ids: ['2'] }, 'member_ids must be an array of user IDs'],
    ['a direct room with no other member', { type: 'direct', member_ids: [] }, 'a direct chat room requires exactly one other member'],
    ['a direct room with only the requester', { type: 'direct', member_ids: [1] }, 'a direct chat room requires exactly one other member'],
    ['a direct room with two other members', { type: 'direct', member_ids: [2, 3] }, 'a direct chat room requires exactly one other member'],
    ['a direct room with a name', { type: 'direct', member_ids: [2], name: 'Bob' }, 'direct chat rooms cannot have a name or avatar'],
    ['a blank group name', { type: 'group', name: '   ' }, 'name must be a non-empty string if provided'],
  ])('rejects %s', (_label, body, error) => {
    expect(validateCreateChatRoomInput(body, requesterId)).toEqual({ valid: false, error });
  });
});

describe('validateUpdateChatRoomBody', () => {
  it('trims the name and keeps the avatar url', () => {
    const result = validateUpdateChatRoomBody({
      name: '  Team  ',
      avatar_url: 'https://example.com/a.png',
    });

    expect(result).toEqual({
      valid: true,
      data: { name: 'Team', avatarUrl: 'https://example.com/a.png' },
    });
  });

  it('accepts a null avatar_url, which removes the avatar', () => {
    expect(validateUpdateChatRoomBody({ avatar_url: null })).toEqual({
      valid: true,
      data: { avatarUrl: null },
    });
  });

  it.each([
    ['no body at all', undefined, 'At least either Name or Avatar must be provided'],
    ['an empty body', {}, 'At least either Name or Avatar must be provided'],
    ['a blank name', { name: '   ' }, "'name' must be a non-empty string"],
    ['a name that is not a string', { name: 5 }, "'name' must be a non-empty string"],
    ['a name over 100 characters', { name: 'a'.repeat(101) }, "'name' must be 100 characters or fewer"],
    ['an avatar_url that is not a string', { avatar_url: 5 }, "'avatar_url' must be a string or null"],
    ['an avatar_url that is not a URL', { avatar_url: 'not a url' }, "'avatar_url' must be a valid URL"],
    ['an avatar_url with another scheme', { avatar_url: 'javascript:alert(1)' }, "'avatar_url' must be a valid URL"],
  ])('rejects %s', (_label, body, message) => {
    expect(validateUpdateChatRoomBody(body)).toEqual({ valid: false, message });
  });
});

describe('validateAddMembersBody', () => {
  it('accepts a list of user ids and removes duplicates', () => {
    expect(validateAddMembersBody({ member_ids: [2, 3, 3] })).toEqual({
      valid: true,
      data: { memberIds: [2, 3] },
    });
  });

  it.each([
    ['no body', undefined],
    ['a missing member_ids', {}],
    ['an empty member_ids array', { member_ids: [] }],
    ['a non-array member_ids', { member_ids: 2 }],
    ['a non-integer id', { member_ids: [1.5] }],
    ['a string id', { member_ids: ['2'] }],
    ['a zero id', { member_ids: [0] }],
    ['a negative id', { member_ids: [-3] }],
    ['an id larger than a Postgres integer', { member_ids: [2_147_483_648] }],
  ])('rejects %s', (_label, body) => {
    expect(validateAddMembersBody(body)).toEqual({
      valid: false,
      message: "'member_ids' must be a non-empty array of user IDs",
    });
  });
});

describe('validateChangeMemberRoleBody', () => {
  it.each([
    ['admin', { role: 'admin' }],
    ['member', { role: 'member' }],
  ])('accepts role: %s', (_label, body) => {
    expect(validateChangeMemberRoleBody(body)).toEqual({
      valid: true,
      data: { role: body.role },
    });
  });

  it.each([
    ['no body', undefined],
    ['a missing role', {}],
    ['an unknown role', { role: 'owner' }],
    ['a non-string role', { role: 1 }],
  ])('rejects %s', (_label, body) => {
    expect(validateChangeMemberRoleBody(body)).toEqual({
      valid: false,
      message: "'role' must be 'admin' or 'member'",
    });
  });
});

describe('validateSendMessageBody', () => {
  it('trims surrounding whitespace from content', () => {
    expect(validateSendMessageBody({ content: '  Hello  ' })).toEqual({
      valid: true,
      data: { content: 'Hello' },
    });
  });

  it('accepts content right at the length limit', () => {
    const content = 'a'.repeat(4000);
    expect(validateSendMessageBody({ content })).toEqual({ valid: true, data: { content } });
  });

  it.each([
    ['no body', undefined, "'content' must be a non-empty string"],
    ['a missing content', {}, "'content' must be a non-empty string"],
    ['a non-string content', { content: 5 }, "'content' must be a non-empty string"],
    ['a blank content', { content: '   ' }, "'content' must be a non-empty string"],
    [
      'content over the length limit',
      { content: 'a'.repeat(4001) },
      "'content' must be 4000 characters or fewer",
    ],
  ])('rejects %s', (_label, body, message) => {
    expect(validateSendMessageBody(body)).toEqual({ valid: false, message });
  });
});

describe('validateChatIdParam', () => {
  it('accepts a plain positive integer', () => {
    expect(validateChatIdParam('42')).toEqual({ valid: true, data: { chatId: 42 } });
  });

  it.each([
    ['a non-numeric id', 'abc'],
    ['a decimal id', '1.5'],
    ['a zero id', '0'],
    ['a negative id', '-3'],
    ['an id in scientific notation', '1e3'],
    ['an id larger than a Postgres integer', '2147483648'],
  ])('rejects %s', (_label, rawChatId) => {
    expect(validateChatIdParam(rawChatId)).toEqual({ valid: false, message: 'Invalid chat room id' });
  });
});

describe('validateUserIdParam', () => {
  it('accepts a plain positive integer', () => {
    expect(validateUserIdParam('42')).toEqual({ valid: true, data: { userId: 42 } });
  });

  it.each([
    ['a non-numeric id', 'abc'],
    ['a decimal id', '1.5'],
    ['a zero id', '0'],
    ['a negative id', '-3'],
    ['an id in scientific notation', '1e3'],
    ['an id with spaces around it', ' 5 '],
    ['an id larger than a Postgres integer', '2147483648'],
  ])('rejects %s', (_label, rawUserId) => {
    expect(validateUserIdParam(rawUserId)).toEqual({ valid: false, message: 'Invalid user id' });
  });
});
