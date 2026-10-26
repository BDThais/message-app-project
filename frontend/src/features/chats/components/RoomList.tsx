import { Link } from '@tanstack/react-router';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Notice } from '@/components/ui/Notice';
import { formatListTime, roomTitle } from '../format';
import { useChatRooms } from '../queries';
import type { ChatRoomSummary } from '../types';

/**
 * The sidebar. On a phone it is the whole screen at `/chat` and gives way to the conversation at
 * `/chat/$chatId`. With a room open the conversation's title is the page's `h1`, so this one is an `h2`.
 */
export function RoomList({ roomOpen }: { roomOpen: boolean }) {
  const rooms = useChatRooms();
  const Heading = roomOpen ? 'h2' : 'h1';

  return (
    <nav
      aria-label="Chats"
      className={`${roomOpen ? 'hidden md:flex' : 'flex'} min-h-0 w-full flex-col border-r border-line bg-surface md:w-80 md:shrink-0`}
    >
      <div className="px-4 py-3">
        <Heading className={roomOpen ? 'text-2xl font-semibold tracking-tight' : undefined}>Chats</Heading>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pb-3">
        {rooms.isError && (
          <div className="flex flex-col items-start gap-2 px-4">
            <Notice tone="error" role="alert">
              {rooms.error.message}
            </Notice>
            <Button type="button" size="sm" variant="secondary" onClick={() => void rooms.refetch()}>
              Try again
            </Button>
          </div>
        )}
        {rooms.isPending && (
          <p role="status" className="px-4 text-sm text-muted">
            Loading chats…
          </p>
        )}
        {rooms.data?.length === 0 && <p className="px-4 text-sm text-muted">You have no chats yet.</p>}
        {rooms.data && rooms.data.length > 0 && (
          <ul>
            {rooms.data.map((room) => (
              <li key={room.id}>
                <RoomLink room={room} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </nav>
  );
}

function RoomLink({ room }: { room: ChatRoomSummary }) {
  const title = roomTitle(room);
  const unread = room.unreadCount > 0;

  return (
    <Link
      to="/chat/$chatId"
      params={{ chatId: String(room.id) }}
      className="flex items-center gap-3 px-4 py-3 text-fg no-underline hover:bg-sunken focus-visible:-outline-offset-2 aria-[current=page]:bg-accent-soft"
    >
      <Avatar name={title} url={room.avatarUrl} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-baseline justify-between gap-2">
          <span className={`truncate ${unread ? 'font-semibold' : 'font-medium'}`}>{title}</span>
          {room.lastMessage && (
            <time dateTime={room.lastMessage.createdAt} className="shrink-0 text-xs text-muted">
              {formatListTime(room.lastMessage.createdAt)}
            </time>
          )}
        </span>
        <span className="flex items-center justify-between gap-2">
          <span className="truncate text-sm text-muted">{room.lastMessage?.content ?? 'No messages yet'}</span>
          {unread && (
            <span className="min-w-5 shrink-0 rounded-full bg-accent px-1.5 text-center text-xs font-semibold leading-5 text-on-accent">
              <span aria-hidden="true">{room.unreadCount > 99 ? '99+' : room.unreadCount}</span>
              <span className="sr-only">{room.unreadCount} unread</span>
            </span>
          )}
        </span>
      </span>
    </Link>
  );
}
