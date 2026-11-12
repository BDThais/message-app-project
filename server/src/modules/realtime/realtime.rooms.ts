// The names of the Socket.io rooms (see "Real-time events" in api.doc.md). One place, so the handshake
// that joins a socket and the emitters that address it cannot disagree about a spelling.

/** Everything for one person on any device: friend events, and being added to a room. */
export const userRoom = (userId: number): string => `user:${userId}`;

/** Everybody in one chat room. */
export const chatRoom = (chatId: number): string => `chat:${chatId}`;

/** The sockets opened with one login session, so that ending the session can end them. */
export const sessionRoom = (sessionId: string): string => `session:${sessionId}`;
