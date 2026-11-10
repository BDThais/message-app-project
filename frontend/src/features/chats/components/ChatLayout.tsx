import { Outlet, useMatch } from '@tanstack/react-router';
import { RoomList } from './RoomList';

/** The `/chat` layout: the room list stays mounted while the person goes from one room to another. */
export function ChatLayout() {
  // On a phone the list gives way to whatever is open: a room, or the form for a new group. Both hooks run every
  // time (not `a || b`): a hook that is skipped on some renders breaks the ones after it.
  const roomMatch = useMatch({ from: '/_app/chat/$chatId', shouldThrow: false });
  const newGroupMatch = useMatch({ from: '/_app/chat/new', shouldThrow: false });
  const roomOpen = roomMatch !== undefined || newGroupMatch !== undefined;

  return (
    <div className="flex min-h-0 flex-1">
      <RoomList roomOpen={roomOpen} />
      <Outlet />
    </div>
  );
}
