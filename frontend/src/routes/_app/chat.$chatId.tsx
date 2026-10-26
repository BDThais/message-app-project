import { createFileRoute } from '@tanstack/react-router';
import { Page } from '@/components/ui/Page';
import { ChatNotFound } from '@/features/chats/components/ChatNotFound';
import { Conversation } from '@/features/chats/components/Conversation';
import { parseChatId } from '@/features/chats/parseChatId';

export const Route = createFileRoute('/_app/chat/$chatId')({
  component: ChatPage,
});

function ChatPage() {
  const chatId = parseChatId(Route.useParams().chatId);

  return <Page layout="fill">{chatId === null ? <ChatNotFound /> : <Conversation key={chatId} chatId={chatId} />}</Page>;
}
