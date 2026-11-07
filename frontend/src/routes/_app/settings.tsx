import { createFileRoute } from '@tanstack/react-router';
import { Page } from '@/components/ui/Page';
import { SettingsPage } from '@/features/account/components/SettingsPage';
import { roomTitle } from '@/features/chats/format';
import { useChatRooms } from '@/features/chats/queries';

export const Route = createFileRoute('/_app/settings')({
  component: Settings,
});

// The settings need the names of rooms the chats feature knows; a feature does not import another
// that imports it (chats uses account), so this page, which may use both, hands the names down.
function Settings() {
  const rooms = useChatRooms();
  const roomName = (chatId: number) => {
    const room = rooms.data?.find(({ id }) => id === chatId);
    return room ? roomTitle(room) : `Chat ${chatId}`;
  };

  return (
    <Page layout="column">
      <SettingsPage roomName={roomName} />
    </Page>
  );
}
