import { useCallback, useLayoutEffect, useRef, useState, type UIEvent } from 'react';
import type { Message } from './types';

const NEAR_BOTTOM_PX = 48;
const NEAR_TOP_PX = 120;

/** Where to scroll so that what the person was looking at stays where it was after messages were added above it. */
export function anchoredScrollTop({
  scrollTop,
  scrollHeight,
  newScrollHeight,
}: {
  scrollTop: number;
  scrollHeight: number;
  newScrollHeight: number;
}): number {
  return scrollTop + (newScrollHeight - scrollHeight);
}

interface Anchor {
  scrollTop: number;
  scrollHeight: number;
  /** Set once the request has been seen running, so that a re-render before it starts does not drop the anchor. */
  sawLoading: boolean;
}

/**
 * The scrolling of the message list. A conversation starts at the bottom, stays at the bottom while
 * new messages come in (always when the person sent the message, only when they were already at the
 * bottom otherwise, so reading older messages is never interrupted), and keeps what is on screen
 * where it is when older messages are added above.
 *
 * Put `[overflow-anchor:none]` on the container: Chrome and Firefox would otherwise also compensate
 * for the added messages, and the two corrections add up to a jump.
 */
export function useMessageScroll({
  messages,
  currentUserId,
  hasOlder,
  isLoadingOlder,
  loadOlder,
}: {
  /** Oldest first, as shown. */
  messages: Message[];
  currentUserId: number;
  hasOlder: boolean;
  isLoadingOlder: boolean;
  loadOlder: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const [atBottom, setAtBottom] = useState(true);
  const anchorRef = useRef<Anchor | null>(null);
  const seenRef = useRef<{ oldestId: number | undefined; newestId: number | undefined }>({
    oldestId: undefined,
    newestId: undefined,
  });

  const oldest = messages[0];
  const newest = messages.at(-1);

  const loadOlderKeepingPosition = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    anchorRef.current = { scrollTop: container.scrollTop, scrollHeight: container.scrollHeight, sawLoading: false };
    loadOlder();
  }, [loadOlder]);

  // A layout effect, not a plain one: the scroll position has to be corrected before the browser paints
  // the new messages, or the list would flash at the wrong place.
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const previous = seenRef.current;
    seenRef.current = { oldestId: oldest?.id, newestId: newest?.id };

    const anchor = anchorRef.current;
    if (anchor) {
      if (isLoadingOlder) anchor.sawLoading = true;
      if (oldest?.id !== previous.oldestId) {
        container.scrollTop = anchoredScrollTop({
          scrollTop: anchor.scrollTop,
          scrollHeight: anchor.scrollHeight,
          newScrollHeight: container.scrollHeight,
        });
        anchorRef.current = null;
        return;
      }
      if (isLoadingOlder || !anchor.sawLoading) return;
      anchorRef.current = null; // the request ended and added nothing: it failed
    }

    const isFirstLoad = previous.newestId === undefined;
    const isNewMessageOfMine = newest?.id !== previous.newestId && newest?.senderId === currentUserId;
    if (isFirstLoad || isNewMessageOfMine || atBottomRef.current) container.scrollTop = container.scrollHeight;
  }, [messages, oldest?.id, newest?.id, newest?.senderId, currentUserId, isLoadingOlder]);

  const onScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      const container = event.currentTarget;
      const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight <= NEAR_BOTTOM_PX;
      atBottomRef.current = nearBottom;
      setAtBottom(nearBottom);
      if (container.scrollTop < NEAR_TOP_PX && hasOlder && !isLoadingOlder) loadOlderKeepingPosition();
    },
    [hasOlder, isLoadingOlder, loadOlderKeepingPosition],
  );

  return { containerRef, onScroll, atBottom, loadOlder: loadOlderKeepingPosition };
}
