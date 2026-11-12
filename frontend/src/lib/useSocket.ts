import { createContext, useContext } from 'react';
import type { AppSocket } from './socket';

/** Provided by `App`. The socket exists for the whole life of the page; whether it is open is the signed-in layout's business. */
export const SocketContext = createContext<AppSocket | null>(null);

export function useSocket(): AppSocket {
  const socket = useContext(SocketContext);
  if (!socket) throw new Error('useSocket was used outside the App component, which provides the socket');
  return socket;
}
