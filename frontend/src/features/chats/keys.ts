// Apart from queries.ts because cache.ts needs the keys and queries.ts needs cache.ts.
export const chatKeys = {
  list: () => ['chats', 'list'] as const,
  messages: (chatId: number) => ['chats', 'messages', chatId] as const,
};
