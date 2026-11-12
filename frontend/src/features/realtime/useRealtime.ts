import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { accountKeys, useMe } from '@/features/account/queries';
import { attachChatEvents, resyncChats } from '@/features/chats/events';
import { attachFriendEvents, resyncFriends } from '@/features/friends/events';
import { useSocket } from '@/lib/useSocket';

/**
 * Opens the socket while somebody is signed in and closes it when nobody is (the `_app` layout calls
 * this): the handshake needs the session, so the connection belongs to it. Each feature says what its
 * events do to the cache; this attaches them, and handles the connection itself:
 *
 * - on every reconnect, the lists are asked for again, because the events sent while the socket was
 *   down are gone (the first connect needs nothing: everything was just loaded);
 * - a refused handshake, or a socket the server closed (it closes the sockets of a session that ended),
 *   means the session may be gone, so `me` is asked for again, and the layout leaves for /login if it is.
 */
export function useRealtime(): void {
  const socket = useSocket();
  const queryClient = useQueryClient();
  const router = useRouter();
  const { data: user } = useMe();
  const userId = user?.id;

  useEffect(() => {
    if (userId === undefined) return;

    const recheckSession = () => void queryClient.invalidateQueries({ queryKey: accountKeys.me() });

    const stopChatEvents = attachChatEvents(socket, queryClient, {
      userId,
      // A room that is open and gone for the person (removed, or deleted by an admin) has nothing left to show.
      onRoomRemoved: (chatId) => {
        if (router.state.location.pathname === `/chat/${chatId}`) void router.navigate({ to: '/chat' });
      },
    });
    const stopFriendEvents = attachFriendEvents(socket, queryClient);

    let hasConnected = false;
    const onConnect = () => {
      if (hasConnected) {
        resyncChats(queryClient);
        resyncFriends(queryClient);
      }
      hasConnected = true;
    };
    const onDisconnect = (reason: string) => {
      if (reason === 'io server disconnect') recheckSession();
    };
    // The server refused the handshake: the client does not try again by itself (`active` is false).
    const onConnectError = () => {
      if (!socket.active) recheckSession();
    };
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onConnectError);
    socket.connect();

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onConnectError);
      stopChatEvents();
      stopFriendEvents();
      socket.disconnect();
    };
  }, [socket, queryClient, router, userId]);
}
