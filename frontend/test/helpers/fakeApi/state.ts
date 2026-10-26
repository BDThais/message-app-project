import type { User } from '@/features/account/types';
import type { Message, PublicUser, RoomType } from '@contract/types';

export const PASSWORD = 'Str0ng!Pass';
export const NEW_PASSWORD = 'An0ther!Pass';

export const john: User = {
  id: 1,
  name: 'JohnDoe',
  email: 'john@example.com',
  tel: '+1234567890',
  avatarUrl: null,
  emailVerified: false,
};

export const bea: PublicUser = { id: 2, name: 'Bea', avatarUrl: null };
export const carl: PublicUser = { id: 3, name: 'Carl', avatarUrl: null };

/** A room of John's, as his list shows it: `name` is the other member's for a direct room, like the server's list. */
export interface FakeRoom {
  id: number;
  type: RoomType;
  name: string | null;
  avatarUrl: string | null;
  createdAt: string;
  /** John's own read marker. */
  lastReadMessageId: number | null;
}

export interface Account {
  user: User;
  password: string;
}

/** The JSON body of a request, as the fake reads it (`undefined` when the request had none). */
export type Body = Record<string, string> | undefined;

/** One request the fake saw: `"POST /api/account/login"` and its parsed JSON body (`undefined` when it had none). */
export interface Call {
  request: string;
  body: unknown;
}

/**
 * The fake server's state, shared by the endpoint files of every feature (accounts and chat rooms
 * today, friends when their endpoints are faked). `signedIn` says whether the cookie in this browser
 * belongs to John.
 */
export function createState({ signedIn }: { signedIn: boolean }) {
  const accounts: Account[] = [{ user: { ...john }, password: PASSWORD }]; // a copy: tests change it

  return {
    accounts,
    /** Mailed tokens that have not been used yet: token -> id of the account the mail went to. */
    verificationTokens: new Map<string, number>(),
    resetTokens: new Map<string, number>(),
    sessionUserId: signedIn ? john.id : (null as number | null),
    /** Make POST /account/email/verification answer 429, as it does within a minute of the last mail. */
    resendLimited: false,
    /** Make POST, PATCH and DELETE on a message answer 400 with this text. */
    messageWriteError: null as string | null,
    /** John's rooms and their messages, oldest first (a message's id is its place). */
    rooms: [] as FakeRoom[],
    messages: [] as Message[],
    /** Gives John a room. A room starts empty, unread-free and created long before any message. */
    addRoom(room: Pick<FakeRoom, 'id' | 'name'> & Partial<Omit<FakeRoom, 'id' | 'name'>>): FakeRoom {
      const added: FakeRoom = {
        type: 'direct',
        avatarUrl: null,
        createdAt: '2026-10-01T09:00:00.000Z',
        lastReadMessageId: null,
        ...room,
      };
      this.rooms.push(added);
      return added;
    },
    /** Puts a message at the end of a room, as if `sender` (`null`: a deleted account) had just sent it. */
    addMessage({
      chatId,
      sender,
      content,
      createdAt,
    }: {
      chatId: number;
      sender: PublicUser | null;
      content: string;
      createdAt?: string;
    }): Message {
      const id = this.messages.length + 1;
      const message: Message = {
        id,
        chatId,
        senderId: sender?.id ?? null,
        content,
        createdAt: createdAt ?? new Date(Date.UTC(2026, 9, 20, 9, 0, id)).toISOString(),
        editedAt: null,
        deletedAt: null,
        sender,
      };
      this.messages.push(message);
      return message;
    },
    /** Make POST /account/logout answer 500, so the sign-out fails and the session stays. */
    logoutFails: false,
    /** While set, every request waits for it before it is answered (to look at a request that is still running). */
    gate: null as Promise<void> | null,
    requests: [] as string[],
    calls: [] as Call[],
    /** Who the cookie belongs to. Setting it signs that user in (or out, with `null`). */
    get session(): User | null {
      return accounts.find((account) => account.user.id === this.sessionUserId)?.user ?? null;
    },
    set session(user: User | null) {
      this.sessionUserId = user ? user.id : null;
    },
    count(request: string): number {
      return this.requests.filter((seen) => seen === request).length;
    },
  };
}

export type FakeServer = ReturnType<typeof createState>;
