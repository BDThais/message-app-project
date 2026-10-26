import { describe, expect, it } from 'vitest';
import { anchoredScrollTop } from '@/features/chats/useMessageScroll';

describe('anchoredScrollTop', () => {
  it('moves down by exactly what was added above, so the same message stays under the same pixel', () => {
    expect(anchoredScrollTop({ scrollTop: 0, scrollHeight: 2500, newScrollHeight: 3000 })).toBe(500);
    expect(anchoredScrollTop({ scrollTop: 80, scrollHeight: 2500, newScrollHeight: 3000 })).toBe(580);
  });

  it('stays where it is when nothing was added', () => {
    expect(anchoredScrollTop({ scrollTop: 80, scrollHeight: 2500, newScrollHeight: 2500 })).toBe(80);
  });
});
