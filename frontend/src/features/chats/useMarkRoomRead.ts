import { useEffect, useRef } from 'react';
import { useDocumentVisible } from '@/lib/useDocumentVisible';
import { useMarkRead } from './queries';

/**
 * Tells the server that the open room has been read, up to its newest loaded message, while there is
 * something unread, that message is on screen (the list is scrolled to the bottom) and the tab is in
 * front. Each message is reported once.
 */
export function useMarkRoomRead({
  chatId,
  unreadCount,
  newestId,
  atBottom,
}: {
  chatId: number;
  unreadCount: number;
  newestId: number | undefined;
  atBottom: boolean;
}): void {
  const { mutate } = useMarkRead(chatId);
  const isVisible = useDocumentVisible();
  const reportedRef = useRef(0);

  useEffect(() => {
    if (newestId === undefined || unreadCount === 0 || !atBottom || !isVisible) return;
    if (reportedRef.current >= newestId) return;
    reportedRef.current = newestId;
    // A failed request is tried again the next time something above changes; the person is not told, nobody asked for it.
    mutate(newestId, { onError: () => (reportedRef.current = 0) });
  }, [newestId, unreadCount, atBottom, isVisible, mutate]);
}
