// Apart from queries.ts because cache.ts needs the keys and queries.ts needs cache.ts.
export const chatKeys = {
  list: () => ['chats', 'list'] as const,
  /** The messages of every room, for what is done to all of them at once. */
  allMessages: () => ['chats', 'messages'] as const,
  messages: (chatId: number) => ['chats', 'messages', chatId] as const,
  /** The member lists of every room. */
  allMembers: () => ['chats', 'members'] as const,
  members: (chatId: number) => ['chats', 'members', chatId] as const,
};
