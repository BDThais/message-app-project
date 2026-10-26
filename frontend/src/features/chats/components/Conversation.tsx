import { useMemo } from 'react';
import { Link } from '@tanstack/react-router';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Notice } from '@/components/ui/Notice';
import { useMe } from '@/features/account/queries';
import { isApiError } from '@/lib/http';
import { roomTitle } from '../format';
import { useChatRooms, useMessages, useSendMessage } from '../queries';
import type { ChatRoomSummary } from '../types';
import { useMarkRoomRead } from '../useMarkRoomRead';
import { useMessageScroll } from '../useMessageScroll';
import { ChatNotFound } from './ChatNotFound';
import { MessageEditor } from './MessageEditor';
import { MessageItem } from './MessageItem';

/** The open room: its title, its messages, and the box to write in. Render it with `key={chatId}` so nothing is carried from one room to the next. */
export function Conversation({ chatId }: { chatId: number }) {
  const { data: user } = useMe();
  const rooms = useChatRooms();
  const messagesQuery = useMessages(chatId);
  const room = rooms.data?.find(({ id }) => id === chatId);

  const messages = useMemo(
    () => (messagesQuery.data ? messagesQuery.data.pages.flatMap((page) => page.messages).reverse() : []),
    [messagesQuery.data],
  );

  const { fetchNextPage } = messagesQuery;
  const scroll = useMessageScroll({
    messages,
    currentUserId: user?.id ?? 0,
    hasOlder: messagesQuery.hasNextPage,
    isLoadingOlder: messagesQuery.isFetchingNextPage,
    loadOlder: () => void fetchNextPage(),
  });

  useMarkRoomRead({
    chatId,
    unreadCount: room?.unreadCount ?? 0,
    newestId: messages.at(-1)?.id,
    atBottom: scroll.atBottom,
  });

  if (!user) return null;
  if (messagesQuery.isError && !messagesQuery.data && isApiError(messagesQuery.error) && messagesQuery.error.status === 404) {
    return <ChatNotFound />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ConversationHeader room={room} />
      <div
        ref={scroll.containerRef}
        onScroll={scroll.onScroll}
        role="log"
        aria-label="Messages"
        tabIndex={0}
        className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain p-4 [overflow-anchor:none]"
      >
        <div className="mt-auto flex flex-col gap-3">
          {messagesQuery.isPending && (
            <p role="status" className="text-center text-sm text-muted">
              Loading messages…
            </p>
          )}
          {messagesQuery.isError && (
            <div className="flex flex-col items-start gap-2">
              <Notice tone="error" role="alert">
                {messagesQuery.error.message}
              </Notice>
              {!messagesQuery.data && (
                <Button type="button" size="sm" variant="secondary" onClick={() => void messagesQuery.refetch()}>
                  Try again
                </Button>
              )}
            </div>
          )}
          {messagesQuery.hasNextPage && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={messagesQuery.isFetchingNextPage}
              onClick={scroll.loadOlder}
            >
              {messagesQuery.isFetchingNextPage ? 'Loading…' : 'Load earlier messages'}
            </Button>
          )}
          {messagesQuery.data && messages.length === 0 && (
            <p className="text-center text-sm text-muted">No messages yet. Say hello!</p>
          )}
          <ol className="flex flex-col gap-3">
            {messages.map((message) => (
              <MessageItem
                key={message.id}
                message={message}
                chatId={chatId}
                mine={message.senderId === user.id}
                showSender={room?.type === 'group'}
              />
            ))}
          </ol>
        </div>
      </div>
      <MessageComposer chatId={chatId} />
    </div>
  );
}

function ConversationHeader({ room }: { room: ChatRoomSummary | undefined }) {
  // Until the room list has loaded (or when the room is not in it yet) there is no name to show.
  const title = room ? roomTitle(room) : 'Chat';

  return (
    <header className="flex items-center gap-3 border-b border-line bg-surface px-4 py-3">
      <Link to="/chat" className="shrink-0 no-underline md:hidden">
        <span aria-hidden="true">← </span>Chats
      </Link>
      <Avatar name={title} url={room?.avatarUrl ?? null} />
      <h1 className="min-w-0 truncate">{title}</h1>
    </header>
  );
}

function MessageComposer({ chatId }: { chatId: number }) {
  const send = useSendMessage(chatId);

  return (
    <div className="border-t border-line bg-surface p-3 sm:p-4">
      <MessageEditor
        label="Message"
        placeholder="Write a message…"
        submitLabel="Send"
        clearOnSubmit
        onSubmit={(content) => send.mutateAsync(content)}
        isPending={send.isPending}
        error={send.error?.message}
      />
    </div>
  );
}
