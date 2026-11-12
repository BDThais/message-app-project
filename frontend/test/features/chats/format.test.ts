import { describe, expect, it } from 'vitest';
import { formatListTime, formatSentAt, roomTitle, typingText } from '@/features/chats/format';

const now = new Date(2026, 9, 25, 15, 30); // 25 October 2026, 15:30 local time
const earlierToday = new Date(2026, 9, 25, 8, 5).toISOString();
const lastWeek = new Date(2026, 9, 18, 8, 5).toISOString();
const lastYear = new Date(2025, 11, 31, 23, 59).toISOString();

describe('roomTitle', () => {
  it("is the room's name, and a stand-in once the other member (direct) or the name (group) is gone", () => {
    expect(roomTitle({ type: 'direct', name: 'Bea' })).toBe('Bea');
    expect(roomTitle({ type: 'direct', name: null })).toBe('Deleted user');
    expect(roomTitle({ type: 'group', name: 'Project chat' })).toBe('Project chat');
    expect(roomTitle({ type: 'group', name: null })).toBe('Group chat');
  });

  it('is "My Documents" for the private room, which the server sends with no name', () => {
    expect(roomTitle({ type: 'private', name: null })).toBe('My Documents');
  });
});

describe('formatListTime', () => {
  it('is only the time today, and only the date on another day', () => {
    expect(formatListTime(earlierToday, now)).toMatch(/:/);
    expect(formatListTime(lastWeek, now)).not.toMatch(/:/);
    expect(formatListTime(lastWeek, now)).not.toContain('2026');
  });

  it('adds the year for a day in another year', () => {
    expect(formatListTime(lastYear, now)).toContain('2025');
  });
});

describe('formatSentAt', () => {
  it('is the time today, and the date and the time on another day', () => {
    expect(formatSentAt(earlierToday, now)).toMatch(/^[^,]*:[^,]*$/);
    expect(formatSentAt(lastWeek, now)).toMatch(/,.*:/);
  });
});

describe('typingText', () => {
  it('is empty for nobody, names one or two people, and says several for more', () => {
    expect(typingText([])).toBe('');
    expect(typingText([{ name: 'Bea' }])).toBe('Bea is typing…');
    expect(typingText([{ name: 'Bea' }, { name: 'Carl' }])).toBe('Bea and Carl are typing…');
    expect(typingText([{ name: 'Bea' }, { name: 'Carl' }, { name: 'Dana' }])).toBe('Several people are typing…');
  });
});
