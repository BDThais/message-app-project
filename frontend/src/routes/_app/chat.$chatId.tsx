import { createFileRoute } from '@tanstack/react-router';
import { Page } from '@/components/ui/Page';
import { ChatNotFound } from '@/features/chats/components/ChatNotFound';
import { Conversation } from '@/features/chats/components/Conversation';
import { RoomMembers } from '@/features/chats/components/RoomMembers';
import { parseChatId } from '@/features/chats/parseChatId';
import { useFriends } from '@/features/friends/queries';

export const Route = createFileRoute('/_app/chat/$chatId')({
  // `?members=true` opens the members panel: it is in the address, so the back button closes it and a link can open it.
  validateSearch: (search: Record<string, unknown>): { members?: true } =>
    search.members === true ? { members: true } : {},
  component: ChatPage,
});

function ChatPage() {
  const chatId = parseChatId(Route.useParams().chatId);
  const { members } = Route.useSearch();

  return (
    <Page layout="fill">
      {chatId === null ? (
        <ChatNotFound />
      ) : (
        <Conversation
          key={chatId}
          chatId={chatId}
          membersPanel={members ? <MembersPanel chatId={chatId} /> : undefined}
        />
      )}
    </Page>
  );
}

// The friends feature imports the chats feature, so the friends are fetched here, only while the panel is open, and handed down.
function MembersPanel({ chatId }: { chatId: number }) {
  const friends = useFriends();
  return <RoomMembers chatId={chatId} friends={friends} />;
}
