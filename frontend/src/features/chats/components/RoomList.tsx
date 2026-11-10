import { Link } from '@tanstack/react-router';
import { Avatar } from '@/components/ui/Avatar';
import { ListState } from '@/components/ui/ListState';
import { useMe } from '@/features/account/queries';
import { formatListTime, roomTitle } from '../format';
import { useChatRooms } from '../queries';
import type { ChatRoomSummary } from '../types';

/**
 * The sidebar. On a phone it is the whole screen at `/chat` and gives way to the conversation at
 * `/chat/$chatId`. With a room open the conversation's title is the page's `h1`, so this one is an `h2`.
 */
export function RoomList({ roomOpen }: { roomOpen: boolean }) {
  const rooms = useChatRooms();
  const { data: user } = useMe();
  const Heading = roomOpen ? 'h2' : 'h1';

  return (
    <nav
      aria-label="Chats"
      className={`${roomOpen ? 'hidden md:flex' : 'flex'} min-h-0 w-full flex-col border-r border-line bg-surface md:w-80 md:shrink-0`}
    >
      <div className="flex items-baseline justify-between gap-2 px-4 py-3">
        <Heading className={roomOpen ? 'text-2xl font-semibold tracking-tight' : undefined}>Chats</Heading>
        <Link to="/chat/new" className="text-sm">
          New group
        </Link>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pb-3">
        <ListState query={rooms} empty="You have no chats yet." loading="Loading chats…" inset>
          {(items) => (
            <ul>
              {items.map((room) => (
                <li key={room.id}>
                  <RoomLink room={room} userId={user?.id} />
                </li>
              ))}
            </ul>
          )}
        </ListState>
      </div>
    </nav>
  );
}

function RoomLink({ room, userId }: { room: ChatRoomSummary; userId: number | undefined }) {
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
          <span className="truncate text-sm text-muted">
            {room.lastMessage
              ? `${room.lastMessage.senderId === userId ? 'You: ' : ''}${room.lastMessage.content}`
              : 'No messages yet'}
          </span>
          {unread && (
            <span className="min-w-5 shrink-0 rounded-full bg-accent px-1.5 text-center text-xs leading-5 font-semibold text-on-accent">
              <span aria-hidden="true">{room.unreadCount > 99 ? '99+' : room.unreadCount}</span>
              <span className="sr-only">{room.unreadCount} unread</span>
            </span>
          )}
        </span>
      </span>
    </Link>
  );
}
