import type { ChatRoomSummary, PublicUser } from './types';

/**
 * A direct room's name is the other member's; it is null once that account is gone. A group's may be null too.
 * The private room has no name at all: its title is this app's own.
 */
export function roomTitle(room: Pick<ChatRoomSummary, 'type' | 'name'>): string {
  if (room.type === 'private') {
    return 'My Documents';
  }
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

/** The line under the messages for the people who are typing: "" for nobody, their names for one or two, then "Several people". */
export function typingText(users: Pick<PublicUser, 'name'>[]): string {
  const [first, second] = users;
  if (!first) return '';
  if (!second) return `${first.name} is typing…`;
  if (users.length === 2) return `${first.name} and ${second.name} are typing…`;
  return 'Several people are typing…';
}
