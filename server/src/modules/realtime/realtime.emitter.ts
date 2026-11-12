import type { FriendRequest, Message, PublicUser, Role } from '../../contract/types';
import type { RealtimeServer } from './realtime.server';
import { chatRoom, sessionRoom, userRoom } from './realtime.rooms';

// What the controllers call after a service has succeeded: one function per event of api.doc.md
// ("Real-time events"). Services never import this: they stay free of Socket.io, so a service can be
// called from anywhere. Without a registered server (every test of the REST endpoints) each function
// does nothing.

let server: RealtimeServer | null = null;

export function setRealtimeServer(next: RealtimeServer | null): void {
  server = next;
}

/**
 * Runs one emission. The write it reports has already been committed, so a failure here must not
 * turn the request into a 500: it is logged, and a client that missed the event gets the same truth
 * from the endpoint the next time it asks.
 */
function publish(send: (io: RealtimeServer) => void): void {
  if (!server) return;
  try {
    send(server);
  } catch (error) {
    console.error('Error sending a real-time event:', error);
  }
}

export function emitMessageNew(message: Message): void {
  publish((io) => io.to(chatRoom(message.chatId)).emit('message:new', { message }));
}

export function emitMessageUpdated(message: Message): void {
  publish((io) => io.to(chatRoom(message.chatId)).emit('message:updated', { message }));
}

export function emitMessageDeleted(chatId: number, messageId: number, deletedAt: Date): void {
  publish((io) =>
    io.to(chatRoom(chatId)).emit('message:deleted', { chatId, messageId, deletedAt: deletedAt.toISOString() }),
  );
}

export function emitChatUpdated(chatId: number, room: { name: string | null; avatarUrl: string | null }): void {
  publish((io) => io.to(chatRoom(chatId)).emit('chat:updated', { chatId, name: room.name, avatarUrl: room.avatarUrl }));
}

/** The room was deleted: everybody in it is told, and then nobody is in it any more. */
export function emitChatDeleted(chatId: number): void {
  publish((io) => {
    io.to(chatRoom(chatId)).emit('chat:removed', { chatId });
    io.in(chatRoom(chatId)).socketsLeave(chatRoom(chatId));
  });
}

/**
 * People were added to the room (or it was just made, and they are its first members): their sockets
 * join it first, so that the event reaches them too, and they receive the room's events from now on.
 */
export function emitMembersAdded(chatId: number, userIds: number[]): void {
  publish((io) => {
    io.in(userIds.map(userRoom)).socketsJoin(chatRoom(chatId));
    io.to(chatRoom(chatId)).emit('member:added', { chatId, userIds });
  });
}

/**
 * Somebody left, or was removed. Their sockets leave the room first, so that a removed member stops
 * receiving it, and then the others are told who went and the person is told the room is gone for them.
 */
export function emitMemberRemoved(chatId: number, userId: number): void {
  publish((io) => {
    io.in(userRoom(userId)).socketsLeave(chatRoom(chatId));
    io.to(chatRoom(chatId)).emit('member:removed', { chatId, userId });
    io.to(userRoom(userId)).emit('chat:removed', { chatId });
  });
}

export function emitMemberRoleChanged(chatId: number, userId: number, role: Role): void {
  publish((io) => io.to(chatRoom(chatId)).emit('member:role_changed', { chatId, userId, role }));
}

export function emitReadUpdated(chatId: number, userId: number, lastReadMessageId: number): void {
  publish((io) => io.to(chatRoom(chatId)).emit('read:updated', { chatId, userId, lastReadMessageId }));
}

export function emitFriendRequest(receiverId: number, request: FriendRequest): void {
  publish((io) => io.to(userRoom(receiverId)).emit('friend:request', { request }));
}

export function emitFriendAccepted(senderId: number, friend: PublicUser): void {
  publish((io) => io.to(userRoom(senderId)).emit('friend:accepted', { friend }));
}

/** A session ended (sign-out): its sockets are closed, and are not let back in without a new one. */
export function disconnectSession(sessionId: string): void {
  publish((io) => io.in(sessionRoom(sessionId)).disconnectSockets());
}

/** Every session of the account ended (a reset or a deletion), or all but `exceptSessionId` (a password change). */
export function disconnectUser(userId: number, { exceptSessionId }: { exceptSessionId?: string } = {}): void {
  publish((io) => {
    const sockets = io.in(userRoom(userId));
    (exceptSessionId === undefined ? sockets : sockets.except(sessionRoom(exceptSessionId))).disconnectSockets();
  });
}
