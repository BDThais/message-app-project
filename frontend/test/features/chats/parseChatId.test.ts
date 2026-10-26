import { describe, expect, it } from 'vitest';
import { parseChatId } from '@/features/chats/parseChatId';

describe('parseChatId', () => {
  it('reads a positive integer within the Postgres integer range', () => {
    expect(parseChatId('1')).toBe(1);
    expect(parseChatId('42')).toBe(42);
    expect(parseChatId('2147483647')).toBe(2147483647);
  });

  it.each(['', '0', '-1', '01', '1.5', '1e3', ' 1', '1 ', 'abc', '2147483648', '99999999999999999999'])(
    'is null for %j, which the API would answer 400 to',
    (param) => {
      expect(parseChatId(param)).toBeNull();
    },
  );
});
