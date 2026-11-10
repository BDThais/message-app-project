import { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  addMembersToCache,
  removeMemberFromCache,
  removeRoomFromCache,
  replaceMemberInCache,
  sortMembers,
  updateRoomInCache,
} from '@/features/chats/cache';
import { chatKeys } from '@/features/chats/keys';
import type { ChatRoomDetail, ChatRoomSummary, Member, Role } from '@/features/chats/types';

function member(id: number, name: string, role: Role = 'member', chatId = 3): Member {
  return { chatId, role, lastReadMessageId: null, member: { id, name, avatarUrl: null } };
}

function room(id: number, overrides: Partial<ChatRoomSummary> = {}): ChatRoomSummary {
  return {
    id,
    type: 'group',
    name: `Room ${id}`,
    avatarUrl: null,
    createdAt: '2026-10-01T09:00:00.000Z',
    lastMessage: null,
    unreadCount: 0,
    ...overrides,
  };
}

const namesOf = (members: Member[] | undefined) => members?.map(({ member }) => member.name);

describe('sortMembers', () => {
  it('puts admins first, then sorts by name with case and accents ignored', () => {
    const sorted = sortMembers([
      member(1, 'Zed'),
      member(2, 'carl'),
      member(3, 'Émile'),
      member(4, 'Bea'),
      member(5, 'Yan', 'admin'),
      member(6, 'adam', 'admin'),
    ]);

    expect(namesOf(sorted)).toEqual(['adam', 'Yan', 'Bea', 'carl', 'Émile', 'Zed']);
  });

  it('does not change the list it is given', () => {
    const members = [member(1, 'Zed'), member(2, 'Bea')];

    sortMembers(members);

    expect(namesOf(members)).toEqual(['Zed', 'Bea']);
  });

  it('keeps two people with the same name in the order of their ids', () => {
    expect(sortMembers([member(9, 'Bea'), member(2, 'Bea')]).map(({ member: { id } }) => id)).toEqual([2, 9]);
  });
});

describe('the member list in the cache', () => {
  let queryClient: QueryClient;
  beforeEach(() => {
    queryClient = new QueryClient();
    queryClient.setQueryData(chatKeys.members(3), [member(1, 'John', 'admin'), member(2, 'Bea')]);
  });
  const cached = () => queryClient.getQueryData<Member[]>(chatKeys.members(3));

  it('adds new members in their place, and does not double one that is there', () => {
    addMembersToCache(queryClient, 3, [member(4, 'Dana'), member(2, 'Bea')]);

    expect(namesOf(cached())).toEqual(['John', 'Bea', 'Dana']);
  });

  it('leaves a list that is not loaded alone', () => {
    addMembersToCache(queryClient, 8, [member(4, 'Dana', 'member', 8)]);

    expect(queryClient.getQueryData(chatKeys.members(8))).toBeUndefined();
  });

  it('replaces a member with the new role and sorts again', () => {
    replaceMemberInCache(queryClient, member(2, 'Bea', 'admin'));

    expect(cached()?.map(({ member: { name }, role }) => `${name}:${role}`)).toEqual(['Bea:admin', 'John:admin']);
  });

  it('removes a member by user id', () => {
    removeMemberFromCache(queryClient, 3, 2);

    expect(namesOf(cached())).toEqual(['John']);
  });

  it('does nothing to a list that is not loaded', () => {
    replaceMemberInCache(queryClient, member(2, 'Bea', 'admin', 8));
    removeMemberFromCache(queryClient, 8, 2);

    expect(queryClient.getQueryData(chatKeys.members(8))).toBeUndefined();
    expect(namesOf(cached())).toEqual(['John', 'Bea']);
  });
});

describe('a room in the cache', () => {
  let queryClient: QueryClient;
  beforeEach(() => {
    queryClient = new QueryClient();
    queryClient.setQueryData(chatKeys.list(), [room(3), room(4)]);
    queryClient.setQueryData(chatKeys.members(3), [member(1, 'John', 'admin')]);
    queryClient.setQueryData(chatKeys.messages(3), { pages: [], pageParams: [] });
  });
  const list = () => queryClient.getQueryData<ChatRoomSummary[]>(chatKeys.list());

  it('takes the new name and avatar from what PATCH answered, and nothing else', () => {
    const detail: ChatRoomDetail = {
      ...room(3, { name: 'Renamed', avatarUrl: 'https://example.com/a.png', unreadCount: 99 }),
      role: 'admin',
    };

    updateRoomInCache(queryClient, detail);

    expect(list()?.[0]).toEqual(room(3, { name: 'Renamed', avatarUrl: 'https://example.com/a.png' }));
    expect(list()?.[1]).toEqual(room(4));
  });

  it('takes a room away with its members and its messages, and leaves the others', () => {
    removeRoomFromCache(queryClient, 3);

    expect(list()?.map(({ id }) => id)).toEqual([4]);
    expect(queryClient.getQueryData(chatKeys.members(3))).toBeUndefined();
    expect(queryClient.getQueryData(chatKeys.messages(3))).toBeUndefined();
  });
});
