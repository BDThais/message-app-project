import type { FriendRequestDirection } from './types';

// Apart from queries.ts because cache.ts needs the keys and queries.ts needs cache.ts.
export const friendKeys = {
  all: () => ['friends'] as const,
  list: () => ['friends', 'list'] as const,
  requests: (direction: FriendRequestDirection) => ['friends', 'requests', direction] as const,
  search: (tel: string) => ['friends', 'search', tel] as const,
  /** Every cached search whatever the number: a person can show up in several. */
  searches: () => ['friends', 'search'] as const,
};
