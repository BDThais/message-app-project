import type { ChatRoomSummary } from './types';

/** A direct room's name is the other member's; it is null once that account is gone. A group's may be null too. */
export function roomTitle(room: Pick<ChatRoomSummary, 'type' | 'name'>): string {
  return room.name ?? (room.type === 'direct' ? 'Deleted user' : 'Group chat');
}

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const dayFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
const dayWithYearFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

function sameDay(a: Date, b: Date): boolean {
  return a.toDateString() === b.toDateString();
}

function dayOf(date: Date, now: Date): string {
  return (date.getFullYear() === now.getFullYear() ? dayFormat : dayWithYearFormat).format(date);
}

/** For the room list, where there is little room: the time today, the date on any other day. */
export function formatListTime(iso: string, now = new Date()): string {
  const date = new Date(iso);
  return sameDay(date, now) ? timeFormat.format(date) : dayOf(date, now);
}

/** Under a message: the time today, the date and the time on any other day. */
export function formatSentAt(iso: string, now = new Date()): string {
  const date = new Date(iso);
  return sameDay(date, now) ? timeFormat.format(date) : `${dayOf(date, now)}, ${timeFormat.format(date)}`;
}
