import { useCallback, useEffect, useRef, useState } from 'react';
import { useMe } from '@/features/account/queries';
import { useSocket } from '@/lib/useSocket';
import type { PublicUser, ServerToClientEvents } from './types';

// A person who has not been heard from for this long has stopped. The sender repeats `typing` more
// often than that for as long as the person types (and the server relays at most one a second).
const TYPING_SHOWN_MS = 4_000;
const TYPING_SEND_INTERVAL_MS = 2_000;

/**
 * Who else is typing in this room now. This is UI state with a timeout, like the draft: the server never
 * stores it, and nothing here reaches the query cache. A person's own message ends their typing at
 * once, and so does leaving the room (render `Conversation` with `key={chatId}`).
 */
export function useTypingUsers(chatId: number): PublicUser[] {
  const socket = useSocket();
  const { data: me } = useMe();
  const myId = me?.id;
  const [typing, setTyping] = useState<PublicUser[]>([]);

  useEffect(() => {
    const timers = new Map<number, ReturnType<typeof setTimeout>>();

    const forget = (userId: number) => {
      clearTimeout(timers.get(userId));
      timers.delete(userId);
      setTyping((current) =>
        current.some(({ id }) => id === userId) ? current.filter(({ id }) => id !== userId) : current,
      );
    };
    const onTyping: ServerToClientEvents['typing'] = ({ chatId: typingChatId, user }) => {
      // The server does not send a socket its own typing, but the person's other tab is the same person.
      if (typingChatId !== chatId || user.id === myId) return;
      setTyping((current) => (current.some(({ id }) => id === user.id) ? current : [...current, user]));
      clearTimeout(timers.get(user.id));
      timers.set(
        user.id,
        setTimeout(() => forget(user.id), TYPING_SHOWN_MS),
      );
    };
    const onMessage: ServerToClientEvents['message:new'] = ({ message }) => {
      if (message.chatId === chatId && message.senderId !== null) forget(message.senderId);
    };

    socket.on('typing', onTyping);
    socket.on('message:new', onMessage);
    return () => {
      socket.off('typing', onTyping);
      socket.off('message:new', onMessage);
      timers.forEach(clearTimeout);
    };
  }, [socket, chatId, myId]);

  return typing;
}

/** The function the message box calls as the person types: it says so to the room, at most every couple of seconds. */
export function useTypingNotifier(chatId: number): () => void {
  const socket = useSocket();
  const lastSentAt = useRef(0);

  return useCallback(() => {
    // Not while disconnected: an event emitted then is kept and sent on reconnect, as typing that is long over.
    if (!socket.connected) return;
    const now = Date.now();
    if (now - lastSentAt.current < TYPING_SEND_INTERVAL_MS) return;
    lastSentAt.current = now;
    socket.emit('typing', { chatId });
  }, [socket, chatId]);
}
