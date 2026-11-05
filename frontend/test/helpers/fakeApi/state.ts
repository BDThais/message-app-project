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
export const dana: PublicUser = { id: 4, name: 'Dana', avatarUrl: null };

/** The phone numbers the fake server knows besides John's (`john.tel`), in the canonical spelling the search wants. */
export const tels = { bea: '+84900000002', carl: '+84900000003', dana: '+84900000004' } as const;

/** Everyone the fake server has an account for, with the number a search finds them by. */
const people: Array<PublicUser & { tel: string }> = [
  { id: john.id, name: john.name, avatarUrl: john.avatarUrl, tel: john.tel },
  { ...bea, tel: tels.bea },
  { ...carl, tel: tels.carl },
  { ...dana, tel: tels.dana },
];

export const personById = (id: number) => people.find((person) => person.id === id);
export const personByTel = (tel: string) => people.find((person) => person.tel === tel);

/** A pending friend request: `fromId` sent it to `toId`. */
export interface FakeFriendRequest {
  id: number;
  fromId: number;
  toId: number;
  createdAt: string;
}

/** A room of John's, as his list shows it: `name` is the other member's for a direct room, like the server's list. */
export interface FakeRoom {
  id: number;
  type: RoomType;
  name: string | null;
  avatarUrl: string | null;
  createdAt: string;
  /** John's own read marker. */
  lastReadMessageId: number | null;
  /** The other member of a direct room, for the room POST /api/chat finds again. */
  memberId?: number;
}

export interface Account {
  user: User;
  password: string;
}

/** The JSON body of a request, as the fake reads it (`undefined` when the request had none). */
export type Body = Record<string, unknown> | undefined;

/** One request the fake saw: `"POST /api/account/login"` and its parsed JSON body (`undefined` when it had none). */
export interface Call {
  request: string;
  body: unknown;
}

/**
 * The fake server's state, shared by the endpoint files of every feature (accounts, chat rooms and
 * friends). `signedIn` says whether the cookie in this browser belongs to John.
 */
export function createState({ signedIn }: { signedIn: boolean }) {
  const accounts: Account[] = [{ user: { ...john }, password: PASSWORD }]; // a copy: tests change it

  return {
    accounts,
    /** Mailed tokens that have not been used yet: token -> id of the account the mail went to. */
    verificationTokens: new Map<string, number>(),
    resetTokens: new Map<string, number>(),
    sessionUserId: signedIn ? john.id : (null as number | null),
    /** Make POST /api/account/email/verification answer 429, as it does within a minute of the last mail. */
    resendLimited: false,
    /** Make POST, PATCH and DELETE on a message answer 400 with this text. */
    messageWriteError: null as string | null,
    /** Make GET /api/friend/search/:tel and POST /api/friend/requests answer 429. */
    searchLimited: false,
    friendRequestLimited: false,
    /** The ids of John's friends, and the requests he sent or was sent that nobody has answered. */
    friendIds: [] as number[],
    friendRequests: [] as FakeFriendRequest[],
    /** A request that `from` sent to `to`; its id is its place, and a later one is newer. Returns it. */
    addFriendRequest({ from, to }: { from: PublicUser; to: PublicUser }): FakeFriendRequest {
      const id = this.friendRequests.length + 1;
      const request: FakeFriendRequest = {
        id,
        fromId: from.id,
        toId: to.id,
        createdAt: new Date(Date.UTC(2026, 9, 20, 9, 0, id)).toISOString(),
      };
      this.friendRequests.push(request);
      return request;
    },
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
    /** Make POST /api/account/logout answer 500, so the sign-out fails and the session stays. */
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
