import { describe, expect, it } from 'vitest';
import { toFriendRequest } from '../../src/modules/friends/friend.serializer';

const created = new Date('2026-09-13T12:00:00.000Z');
const request = { id: 4, createdAt: created, user: { id: 2, name: 'Bob', avatarUrl: null } };

describe('toFriendRequest', () => {
  it('turns the timestamp into an ISO 8601 string and keeps the other party', () => {
    expect(toFriendRequest(request)).toEqual({ id: 4, createdAt: '2026-09-13T12:00:00.000Z', user: { id: 2, name: 'Bob', avatarUrl: null } });
  });

  it('leaves nothing that JSON would change (no Date)', () => {
    const sent = toFriendRequest(request);

    expect(JSON.parse(JSON.stringify(sent))).toEqual(sent);
  });

  it('names its fields: a property the service data or the user happens to carry is not sent', () => {
    const sent = toFriendRequest({ ...request, senderId: 1, user: { ...request.user, email: 'bob@example.com' } } as typeof request);

    expect(Object.keys(sent).sort()).toEqual(['createdAt', 'id', 'user']);
    expect(Object.keys(sent.user).sort()).toEqual(['avatarUrl', 'id', 'name']);
  });
});
