import { Outlet, useMatch } from '@tanstack/react-router';
import { RoomList } from './RoomList';

/** The `/chat` layout: the room list stays mounted while the person goes from one room to another. */
export function ChatLayout() {
  const roomOpen = useMatch({ from: '/_app/chat/$chatId', shouldThrow: false }) !== undefined;

  return (
    <div className="flex min-h-0 flex-1">
      <RoomList roomOpen={roomOpen} />
      <Outlet />
    </div>
  );
}
