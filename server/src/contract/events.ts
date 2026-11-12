// The Socket.io events, from the server to the browser and back, typed for both ends (see "Real-time
// events" in api.doc.md). Like the rest of this folder: nothing here imports from outside it, and
// every value is JSON.
//
// An event is a notification, never a write: it says what the REST endpoint of the same name already
// did, so a client that missed it gets the same truth by asking again.

import type { FriendRequest, Message, PublicUser, Role } from './types';

export interface ServerToClientEvents {
  /** To every socket in the room, the sender's own included. */
  'message:new': (payload: { message: Message }) => void;
  /** The message as PATCH answers with it. Not sent for an edit that changed nothing. */
  'message:updated': (payload: { message: Message }) => void;
  'message:deleted': (payload: { chatId: number; messageId: number; deletedAt: string }) => void;
  /** A group's new name and avatar (a room's own, so the same for every member). */
  'chat:updated': (payload: { chatId: number; name: string | null; avatarUrl: string | null }) => void;
  /** The room is gone for the person: it was deleted, or they left or were removed. */
  'chat:removed': (payload: { chatId: number }) => void;
  /** To the whole room, the new members included: they are in it from now on. */
  'member:added': (payload: { chatId: number; userIds: number[] }) => void;
  'member:removed': (payload: { chatId: number; userId: number }) => void;
  'member:role_changed': (payload: { chatId: number; userId: number; role: Role }) => void;
  /** The person's marker moved forward; it is not sent when the call changed nothing. */
  'read:updated': (payload: { chatId: number; userId: number; lastReadMessageId: number }) => void;
  /** To the receiver: `user` is the sender, as in their GET /api/friend/requests. */
  'friend:request': (payload: { request: FriendRequest }) => void;
  /** To the person who sent the request: `friend` is the one who accepted it. */
  'friend:accepted': (payload: { friend: PublicUser }) => void;
  /** Somebody else is typing in the room. Never stored. */
  typing: (payload: { chatId: number; user: PublicUser }) => void;
}

export interface ClientToServerEvents {
  /** "I am typing in this room": relayed to the room's other sockets if the sender is in it. */
  typing: (payload: { chatId: number }) => void;
}
