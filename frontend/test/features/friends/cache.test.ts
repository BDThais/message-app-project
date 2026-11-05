import { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  addFriendToCache,
  addRequestToCache,
  removeFriendFromCache,
  removeRequestFromCache,
  setRelationshipInSearches,
  sortFriends,
} from '@/features/friends/cache';
import { friendKeys } from '@/features/friends/keys';
import type { FriendRequest, PublicUser, SearchResult } from '@/features/friends/types';

const user = (id: number, name: string): PublicUser => ({ id, name, avatarUrl: null });
const request = (id: number, other: PublicUser): FriendRequest => ({
  id,
  createdAt: `2026-10-20T09:00:${String(id).padStart(2, '0')}.000Z`,
  user: other,
});

let queryClient: QueryClient;
beforeEach(() => {
  queryClient = new QueryClient();
});

const friends = () => queryClient.getQueryData<PublicUser[]>(friendKeys.list());
const requests = (direction: 'incoming' | 'outgoing') => queryClient.getQueryData<FriendRequest[]>(friendKeys.requests(direction));

describe('sortFriends', () => {
  it('sorts by name without regard to case, and by id when two names are the same', () => {
    const sorted = sortFriends([user(5, 'dana'), user(4, 'Carl'), user(3, 'bea'), user(2, 'Bea'), user(1, 'Adam')]);

    expect(sorted.map(({ id }) => id)).toEqual([1, 2, 3, 4, 5]);
  });

  it('does not change the list it was given', () => {
    const given = [user(2, 'Bea'), user(1, 'Adam')];
    sortFriends(given);
    expect(given.map(({ id }) => id)).toEqual([2, 1]);
  });
});

describe('the friend list', () => {
  it('puts a new friend in its place by name, once however often it is added', () => {
    queryClient.setQueryData(friendKeys.list(), [user(2, 'Bea'), user(4, 'Dana')]);

    addFriendToCache(queryClient, user(3, 'carl'));
    addFriendToCache(queryClient, user(3, 'carl'));

    expect(friends()?.map(({ id }) => id)).toEqual([2, 3, 4]);
  });

  it('leaves a list that was never loaded alone: the server will have the friend', () => {
    addFriendToCache(queryClient, user(3, 'Carl'));
    removeFriendFromCache(queryClient, 3);

    expect(friends()).toBeUndefined();
  });

  it('removes a friend, and keeps the same list when there is no such friend', () => {
    const before = [user(2, 'Bea'), user(3, 'Carl')];
    queryClient.setQueryData(friendKeys.list(), before);

    removeFriendFromCache(queryClient, 9);
    expect(friends()).toBe(before);
    removeFriendFromCache(queryClient, 2);
    expect(friends()?.map(({ id }) => id)).toEqual([3]);
  });
});

describe('the lists of requests', () => {
  it('puts a request just sent first, once however often it is added', () => {
    queryClient.setQueryData(friendKeys.requests('outgoing'), [request(1, user(2, 'Bea'))]);

    addRequestToCache(queryClient, 'outgoing', request(2, user(3, 'Carl')));
    addRequestToCache(queryClient, 'outgoing', request(2, user(3, 'Carl')));

    expect(requests('outgoing')?.map(({ id }) => id)).toEqual([2, 1]);
    expect(requests('incoming')).toBeUndefined();
  });

  it('removes a request by its id from whichever list holds it, and only that one', () => {
    queryClient.setQueryData(friendKeys.requests('incoming'), [request(1, user(2, 'Bea')), request(2, user(3, 'Carl'))]);
    queryClient.setQueryData(friendKeys.requests('outgoing'), [request(3, user(4, 'Dana'))]);

    removeRequestFromCache(queryClient, 3);
    removeRequestFromCache(queryClient, 1);
    removeRequestFromCache(queryClient, 99);

    expect(requests('incoming')?.map(({ id }) => id)).toEqual([2]);
    expect(requests('outgoing')).toEqual([]);
  });
});

describe('the cached searches', () => {
  const found = (id: number, overrides: Partial<SearchResult> = {}): SearchResult => ({
    ...user(id, `User ${id}`),
    relationship: 'none',
    ...overrides,
  });
  const search = (tel: string) => queryClient.getQueryData<SearchResult | null>(friendKeys.search(tel));

  it('changes the person wherever a search shows them, and no one else', () => {
    queryClient.setQueryData(friendKeys.search('+84900000002'), found(2));
    queryClient.setQueryData(friendKeys.search('+84900000003'), found(3));
    queryClient.setQueryData(friendKeys.search('+84900000099'), null); // a search that found no one

    setRelationshipInSearches(queryClient, 2, 'request_sent', 7);

    expect(search('+84900000002')).toMatchObject({ id: 2, relationship: 'request_sent', requestId: 7 });
    expect(search('+84900000003')).toEqual(found(3));
    expect(search('+84900000099')).toBeNull();
  });

  it('drops the request id when the person is no longer in a request state', () => {
    queryClient.setQueryData(friendKeys.search('+84900000002'), found(2, { relationship: 'request_received', requestId: 7 }));

    setRelationshipInSearches(queryClient, 2, 'friend');

    expect(search('+84900000002')?.relationship).toBe('friend');
    expect(search('+84900000002')?.requestId).toBeUndefined();
  });

  it('does not touch the cache entry when nothing changes', () => {
    const before = found(2, { relationship: 'friend' });
    queryClient.setQueryData(friendKeys.search('+84900000002'), before);

    setRelationshipInSearches(queryClient, 2, 'friend');

    expect(search('+84900000002')).toBe(before);
  });
});
