# Message App Frontend Planning & Progress

## Overview

This is the plan and progress log for the React frontend in `frontend/`. The backend (API, database, tests) is documented in `./backend.doc.md`; this document covers the frontend and carries the part of the API it needs, in "API contract" (a condensed copy: `./backend.doc.md` is the source of truth, and the two change together).

The frontend is built as a series of small steps (see "Implementation steps"). Each step ends with something that runs, so problems with the API's shapes show up early, while they are still cheap to fix on the server.

## Tech Stack

- React 19 + TypeScript
- Vite (dev server and build)
- TanStack Router (file-based routing, `src/routes/`)
- TanStack Query (all data that comes from the server)
- Socket.io client (planned, step 6)
- Vitest + Testing Library + jsdom (tests)
- Styling: not decided yet (see "Open questions")

Node `^20.19.0 || >=22.12.0` is required (Vite 8).

## Current Implementation Status

Completed (step 1, "scaffold"):

- Vite + React + TypeScript project in `frontend/`, strict TypeScript settings
- Dev server on port 5173 with a proxy that forwards `/api/...` to the Express server (see "How the frontend talks to the server")
- `src/lib/http.ts`: the `api` fetch wrapper and the `ApiError` class
- `src/lib/queryClient.ts`: the query client (retry policy, one place that reacts to a 401)
- `src/features/account/`: `types.ts`, `api.ts` (`getMe`, `login`, `logout`), `queries.ts` (`meQueryOptions`, `useMe`, `useLogin`, `useLogout`), `guards.ts` (`requireUser`, `redirectIfSignedIn`, `safeRedirectPath`)
- TanStack Router with the `me` guard: `_app` layout (signed-in users only), `_guest` layout (signed-out visitors only), `/` redirecting to `/chat`, a not-found page
- A deliberately thin login page and a placeholder `/chat` page with a sign-out button, so the whole loop (guard, cookie, cache, sign-out) can be tried end to end
- Tests: the fetch wrapper, the query client's rules, the guards, and one app-level test file that runs the sign-in loop through the real router and screens against a fake API (see "Testing")

Still planned:

- Sign-up, email verification, forgot/reset password screens (step 2)
- Room list, conversation, sending/editing/deleting messages (step 3)
- Friends (step 4)
- Account settings and room management (step 5)
- Socket.io (step 6)
- Visual design, deployment configuration (step 7)

## Running the frontend

The server must be running on port 3000 (`npm run dev` in `server/`, with its database and `.env` set up as described in the root README). Then, from `frontend/`:

```powershell
npm install        # first time (npm ci installs exactly what package-lock.json says)
npm run dev        # http://localhost:5173
npm test           # Vitest: no server and no database needed
npm run typecheck  # tsc for the app and for the config files
npm run build      # vite build, then the type check
```

- `frontend/.env` is optional. `API_PROXY_TARGET` (default `http://localhost:3000`) is where the dev server forwards `/api` to; see `.env.example`.
- `npm run dev` uses `strictPort`: if 5173 is taken it stops instead of moving to 5174, because the server's mails link to `http://localhost:5173/verify-email` and `/reset-password` (`EMAIL_VERIFICATION_URL`, `PASSWORD_RESET_URL`).
- `src/routeTree.gen.ts` is generated from `src/routes/` by the router plugin on every `dev` and `build`. Commit it. It is why `npm run build` runs `vite build` before the type check: after adding a route file, the type check alone would complain until the file has been regenerated.

## How the frontend talks to the server

**Development.** The browser only talks to the Vite dev server. Requests to `/api/...` are forwarded to `http://localhost:3000/...` with the `/api` prefix removed. So the session cookie is a first-party cookie, and no CORS configuration is needed. The prefix is there because the server's route names (`/account`, `/chat`, `/friend`) are also the names of pages (`/chat/:chatId`).

**Cookie.** The session cookie is `HttpOnly`, `SameSite=Lax`, and `Secure` in production (`middlewares/SessionCookie.ts`). The frontend never reads it. Every request is sent with `credentials: 'include'`.

**Production (planned, step 7).** Serve the built frontend and route `/api` (and later `/socket.io`) to the API from the same origin, for example with a reverse proxy. With `SameSite=Lax` the frontend and the API have to be on the same site anyway. Two server-side consequences:

- CORS is only needed if the two end up on different origins. Then `cors` has to be added (see "Cookie / CORS Notes" in `./backend.doc.md`) and the cookie changed to `SameSite=None; Secure`, as the comment in `SessionCookie.ts` says.
- Behind a reverse proxy, every request arrives from the proxy's address unless Express is told to trust the proxy's `X-Forwarded-For` header (`app.set('trust proxy', ...)`; `app.ts` does not set it today). The rate limiters key on the IP, so without it all users would share one limit.

**Errors.** `api` throws an `ApiError` (`status`, `message`, `body`) for every non-2xx answer. `message` is the server's `{ error }` text, `body` keeps the whole parsed body for the few errors that carry more (`chatIds` on the `409` of `DELETE /account/me`). A request that never got an answer is an `ApiError` with status `0`. Endpoints that answer `204` resolve to `undefined`.

**A 401 does not always mean "signed out".** `POST /account/password` and `DELETE /account/me` answer `401` for a wrong password with the session still fine, and login answers `401` for bad credentials. So the query client does not sign anyone out on a 401: it calls `onUnauthorized` (set in `createApp.ts`), which refetches `GET /account/me`. That endpoint answers `user: null` when the session really is gone, and the `_app` layout then sends the person to `/login`.

## Foundation: server state and UI state

Two kinds of state, kept apart:

- **Server state** is data that lives on the server and that the UI only borrows: the current user, rooms, messages, members, friends, requests. TanStack Query caches it, refetches it when it is stale and shares one copy between all screens. It is never copied into `useState` or Context.
- **UI state** is what only the browser cares about: the draft being typed, which dialog is open, which tab is selected. This is plain `useState` (or a URL search parameter if a link should reproduce it).

Why it matters here: when a socket event arrives (step 6), the handler does not "update the screen". It updates the cache, and every screen that shows that data re-renders. Mutations (send, edit, delete) update the same cache with the result the API returned.

## Project structure

```text
frontend/
├── .env.example                  // API_PROXY_TARGET for the dev proxy
├── .gitignore
├── index.html
├── package.json
├── tsconfig.json                 // the app (src/), browser types
├── tsconfig.node.json            // vite.config.ts and vitest.config.ts, Node types
├── vite.config.ts                // router plugin, React plugin, port 5173, /api proxy
├── vitest.config.ts              // test settings (kept apart so tests skip the router plugin and the proxy)
└── src/
    ├── main.tsx                  // mounts the app (providers + router + query devtools)
    ├── createApp.ts              // builds the query client and the router and connects them; also used by tests
    ├── router.tsx                // router settings and the type registration
    ├── routeTree.gen.ts          // GENERATED by the router plugin; committed
    ├── styles.css                // deliberately plain for now
    ├── app.test.tsx              // the sign-in loop through the real app against a fake API
    ├── routes/                   // thin: URL, guard, and which feature components to show
    │   ├── __root.tsx            // router context type, not-found page
    │   ├── index.tsx             // "/" -> /chat
    │   ├── _guest.tsx            // layout: signed-in users are sent to /chat
    │   ├── _guest/login.tsx
    │   ├── _app.tsx              // layout: signed-out users are sent to /login; header with sign-out
    │   └── _app/chat.index.tsx   // placeholder
    ├── features/
    │   └── account/
    │       ├── types.ts          // User, LoginInput
    │       ├── api.ts            // one function per endpoint, no React
    │       ├── queries.ts        // query keys, queryOptions, hooks
    │       ├── guards.ts         // beforeLoad helpers, safeRedirectPath
    │       └── guards.test.ts
    └── lib/
        ├── http.ts               // api, ApiError
        ├── http.test.ts
        ├── queryClient.ts        // createQueryClient, shouldRetry
        └── queryClient.test.ts
```

Planned additions: `features/chats/`, `features/messages/`, `features/friends/` (each with `types.ts`, `api.ts`, `queries.ts`, `components/`), `components/ui/` for shared buttons, inputs, avatar and dialog, and `lib/socket.ts` (step 6).

## Conventions

- **Feature folders**, mirroring the server's `modules/`: everything for one feature lives under `src/features/<feature>/`. Route files stay thin.
- **`api.ts` has the only mention of a URL path.** Components never call `fetch` or `api` directly: they use hooks from `queries.ts`.
- **One query-key factory per feature** (`accountKeys.me()`, later `chatKeys.list()`, `chatKeys.messages(chatId)`), so no key is typed by hand in two places.
- **Cache updates go through functions** (`setSignedInUser`, later `addMessageToCache`, `removeChatFromCache`). Mutations and socket handlers call the same function, and such a function must be idempotent by id, so a message that arrives twice (the sender's own REST response and the socket event) is stored once.
- **Whatever the server decides, the server decides.** Client-side checks (a password hint, a required field) exist to save a round trip, never to replace the server's validation. Show the server's `{ error }` text.
- **TypeScript:** `strict` and `noUncheckedIndexedAccess`, like the server. `exactOptionalPropertyTypes` is off here because React's and TanStack's own types do not follow it.
- **Types of API responses are written by hand** in each feature's `types.ts`, from the shapes in "API contract". A shared package or generated types can come later if keeping them in step becomes a chore.
- **Files:** components `PascalCase.tsx`, everything else `camelCase.ts`, tests next to the file as `<file>.test.ts(x)`.

## Routing and authentication

| Path | File in `src/routes/` | Layout and rule | Status |
| --- | --- | --- | --- |
| `/` | `index.tsx` | redirects to `/chat` | done |
| `/login` | `_guest/login.tsx` | `_guest`: a signed-in user is sent to `/chat` | done (thin version) |
| `/signup` | `_guest/signup.tsx` | `_guest` | step 2 |
| `/forgot-password` | `_guest/forgot-password.tsx` | `_guest` | step 2 |
| `/verify-email` | `verify-email.tsx` | none: works signed in or out | step 2 |
| `/reset-password` | `reset-password.tsx` | none: works signed in or out | step 2 |
| `/chat` | `_app/chat.index.tsx` | `_app`: a signed-out visitor is sent to `/login` | placeholder |
| `/chat/$chatId` | `_app/chat.$chatId.tsx` | `_app` | step 3 |
| `/friends` | `_app/friends.tsx` | `_app` | step 4 |
| `/settings` | `_app/settings.tsx` | `_app` | step 5 |

How the guards work:

- `_app` runs `requireUser` in `beforeLoad`: it asks the cache for `me` (one `GET /account/me` the first time, then the cached answer for 5 minutes) and redirects to `/login?redirect=<where they were going>` when nobody is signed in. Because it runs before the route renders, no page behind it ever starts a request without a session.
- `_guest` runs `redirectIfSignedIn`, so a signed-in user who opens `/login` lands on `/chat`.
- `/verify-email` and `/reset-password` are plain top-level routes: the links in the emails must work whether or not the person happens to be signed in.
- After signing in, the login page goes to the `redirect` parameter, but only through `safeRedirectPath`: it must start with a single `/`. Anything else (`https://...`, `//host`, `/\host`) falls back to `/chat`, so a crafted login link cannot send people to another site.
- A guard only runs on navigation. When the session ends while a page is open (a request answers 401 and `me` then comes back empty), the `_app` layout notices that the cached user became `null` and navigates to `/login?redirect=...`. Signing out on purpose goes to plain `/login`. The layout reads the current location once, inside the effect: a hook that follows the location would run the effect again for the `/login` URL it has just navigated to and nest the `redirect` parameter without end (the app-level test caught exactly this).
- Signing in or out replaces the whole cache except `me` (`setSignedInUser`), so the next person at this tab never sees the previous user's rooms or messages.

## API contract

Everything a screen needs to know about the server's API, so a frontend session does not need `./backend.doc.md`. It is a condensed copy: `./backend.doc.md` stays the source of truth and has the server-side detail (limiters, transactions, locks, tests). When an endpoint's request, response, status code or error text changes, change both documents in the same patch.

### Request and response conventions

- In the browser every path below is prefixed with `/api` (see "How the frontend talks to the server"). Bodies are JSON.
- **Request bodies use snake_case, responses use camelCase.** Going out: `avatar_url`, `member_ids`, `receiver_id`, `message_id`, `current_password`, `new_password`. Coming back: `avatarUrl`, `createdAt`, `lastReadMessageId`, `unreadCount`.
- Ids are positive integers up to 2147483647 (a Postgres `INTEGER`). A path or query id that is not one answers `400`.
- Timestamps are ISO 8601 strings in UTC (`"2026-09-13T12:00:00.000Z"`), typed `string`.
- Every `4xx` and `5xx` has the body `{ "error": string }`: show that text. Two errors carry one extra key: `chatIds` (the `409` of `DELETE /account/me`) and `requestId` (the `409` "they already sent you a request" of `POST /friend/requests`). A malformed JSON body is a `400`.
- Without a session, every endpoint except the public ones answers `401 { "error": "Unauthorized Access" }`. Public: signup, login, logout, `GET /account/me` (never a 401), `POST /account/email/verify`, `POST /account/password/reset-request`, `POST /account/password/reset`.
- `204` has no body. `429` is a rate limit; its text is in `error` (the limits are listed at the end of this section).
- Every `/chat/:chatid/...` path answers `400` for an invalid `:chatid` and `404 { "error": "Chat room not found" }` when the requester is not a member (a room that does not exist gets the same answer). Both are left out of the tables below.

### Shapes

```ts
type Role = 'admin' | 'member';

/** Your own account: login, GET /account/me, PATCH /account/me. */
interface User { id: number; name: string; email: string; tel: string; avatarUrl: string | null; emailVerified: boolean }

/** Any other user. Never has an email or a tel. */
interface PublicUser { id: number; name: string; avatarUrl: string | null }

/** GET /chat, one entry per room. */
interface ChatRoomSummary {
  id: number;
  type: 'direct' | 'group';
  name: string | null;       // direct room: the other member's name (null once they are gone); group room: its own name, may be null
  avatarUrl: string | null;  // direct room: the other member's avatar
  createdAt: string;
  lastMessage: { content: string; createdAt: string } | null; // newest message that is not deleted; no id, no sender
  unreadCount: number;
}

/** GET /chat/:chatid. */
interface ChatRoomDetail extends ChatRoomSummary { role: Role } // the requester's own role

/** Members of a room: GET/POST/PATCH under /chat/:chatid/member, and `members` of POST /chat. */
interface Member { chatId: number; role: Role; lastReadMessageId: number | null; member: PublicUser }

interface Message {
  id: number;
  chatId: number;
  senderId: number | null;   // null when the sender has deleted their account
  content: string;           // '' once the message is deleted
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  sender: PublicUser | null; // null together with senderId
}

/** GET /friend/requests, POST /friend/requests. `user` is always the other party. */
interface FriendRequest { id: number; createdAt: string; user: PublicUser }

/** GET /friend/search/:tel. `requestId` only for the two request states. */
type Relationship = 'self' | 'friend' | 'request_sent' | 'request_received' | 'none';
interface SearchResult extends PublicUser { relationship: Relationship; requestId?: number }
```

### Account endpoints

| Endpoint | Request | Success | Errors a screen handles |
| --- | --- | --- | --- |
| `POST /account/signup` | `{ name, email, tel, password }` | `201 { message }`; does not sign in; a verification link is mailed | `400` (the rule that failed, see "Rules"); `409` email or phone number taken |
| `POST /account/login` | `{ email, password }` | `200 { user: User }`, sets the cookie | `400` missing field; `401 Invalid email or password`; `429` |
| `GET /account/me` | none | `200 { user: User }` or `{ user: null }` when signed out | none |
| `POST /account/logout` | none | `200 { user: null }`, clears the cookie | none |
| `PATCH /account/me` | `{ name?, avatar_url? }`, at least one; `name` follows the signup rule, `avatar_url` an `http:` or `https:` URL or `null` | `200 { user: User }` | `400` |
| `POST /account/password` | `{ current_password, new_password }` | `204`; the other sessions are signed out, this one stays | `400`; `401 Current password is incorrect` (still signed in); `429` |
| `DELETE /account/me` | `{ password }` | `204`, cookie cleared | `400`; `401 Password is incorrect` (still signed in); `409 { error, chatIds: number[] }` the user is the only admin of those group rooms; `429` |
| `POST /account/email/verify` | `{ token }` | `204`; `emailVerified` is now `true` | `400 This verification link is invalid or has expired`; `429` |
| `POST /account/email/verification` | none | `204`; mails a new link, the old one stops working | `409 Email is already verified`; `429` (a link under a minute old, or too many) |
| `POST /account/password/reset-request` | `{ email }` | `202 { message }` for every well-formed email, known or not | `400` (missing, or not an address); `429` |
| `POST /account/password/reset` | `{ token, new_password }` | `204`; does not sign in, every session of the account is deleted | `400` (weak password, or `This reset link is invalid or has expired`); `429` |

### Chat room endpoints

| Endpoint | Request | Success | Errors a screen handles |
| --- | --- | --- | --- |
| `POST /chat` | `{ type: 'direct' or 'group', member_ids?, name?, avatar_url? }` | `201` new room, `200` existing direct room reused: `{ id, type, name, avatarUrl, createdAt, members: Member[] }` | `400`; `403 Only your friends can be added to a chat room` (a stranger and an unknown id look the same) |
| `GET /chat` | none | `200 { chatRooms: ChatRoomSummary[] }`, most recent activity first | none |
| `GET /chat/:chatid` | none | `200 { chatRoom: ChatRoomDetail }` | none |
| `PATCH /chat/:chatid` | `{ name?, avatar_url? }`, at least one | `200 { chatRoom: { id, type, name, avatarUrl, createdAt } }`: no `lastMessage`, `unreadCount` or `role`, so merge it into the cached room | `400`; `403` not an admin, or a direct room |
| `DELETE /chat/:chatid` | none | `204` | `403` not an admin, or a direct room |
| `GET /chat/:chatid/member` | none | `200 { members: Member[] }`, admins first, then by name; no pagination | none |
| `POST /chat/:chatid/member` | `{ member_ids }`, non-empty | `201` when someone was added, `200` when everyone was already in: `{ addedMembers: Member[], alreadyMemberIds: number[] }` | `400`; `403` not an admin, a direct room, or someone is not your friend (nobody is added) |
| `DELETE /chat/:chatid/member/:userid` | none | `204` | `400`; `403` removing someone else without being an admin, or anyone but yourself in a direct room; `404` not a member; `409` the only admin cannot leave or be removed while others remain |
| `PATCH /chat/:chatid/member/:userid` | `{ role: 'admin' or 'member' }` | `200 { member: Member }` | `400`; `403` not an admin, or a direct room; `404` not a member; `409` the only admin cannot be demoted while others remain |
| `POST /chat/:chatid/message` | `{ content }` | `201 { message: Message }` | `400` |
| `GET /chat/:chatid/message` | query `before?` (a message id), `limit?` (1 to 100, default 50) | `200 { messages: Message[], hasMore }`, newest first | `400` |
| `PATCH /chat/:chatid/message/:message_id` | `{ content }` | `200 { message: Message }` | `400`; `403 You can only edit your own messages`; `404 Message not found in this chat room` (also for a deleted message) |
| `DELETE /chat/:chatid/message/:message_id` | none | `204` | `400`; `403 You can only delete your own messages`; `404` as above |
| `PUT /chat/:chatid/read` | `{ message_id }` (a number) | `200 { lastReadMessageId }` | `400`; `404 Message not found in this chat room` |

### Friend endpoints

| Endpoint | Request | Success | Errors a screen handles |
| --- | --- | --- | --- |
| `GET /friend/search/:tel` | none; `:tel` in the canonical form below | `200 { user: SearchResult }`, or `{ user: null }` when nobody has that number | `400` not a canonical E.164 number; `429` |
| `POST /friend/requests` | `{ receiver_id }` | `201 { request: FriendRequest }` (`user` is the receiver) | `400` (invalid id, yourself, unknown user); `409` already friends, already sent, or they already sent you one (that body has `requestId`: offer "Accept"); `429` |
| `GET /friend/requests` | query `direction?`: `incoming` (default) or `outgoing` | `200 { requests: FriendRequest[] }`, newest first | `400` any other `direction` |
| `POST /friend/requests/:id/accept` | none; `:id` is a request id | `201 { friend: PublicUser }`; does not create a room | `400`; `404` (only the receiver can accept) |
| `DELETE /friend/requests/:id` | none; `:id` is a request id | `204`: the receiver rejects, the sender cancels | `400`; `404` |
| `GET /friend` | none | `200 { friends: PublicUser[] }`, by name, case-insensitive; no pagination | none |
| `DELETE /friend/:id` | none; `:id` is a **user** id | `204`; any existing direct room keeps working | `400`; `404` not friends |

### Rules the screens depend on

#### Account

- Signup rules to hint at: `name` letters and digits only; `password` at least 8 characters with an upper-case letter, a lower-case letter, a digit and a special character; `tel` in international format with the leading `+`. The server also accepts spaces, dashes and parentheses in `tel` and stores the canonical form (`+` and digits only), and it answers with the text of the first rule that failed (`All fields are required` first). Client-side checks only save a round trip: show the server's `error`.
- Signup does not sign the user in. It mails a verification link (`EMAIL_VERIFICATION_URL#token=...`), and so does `POST /account/email/verification`. The token is in the URL fragment: the page reads it from `location.hash`, posts it to `POST /account/email/verify`, and removes it from the address bar.
- Password reset: the mailed link is `PASSWORD_RESET_URL#token=...`; the page posts `{ token, new_password }` (the new password follows the signup rules), after which the person signs in again. Only a verified address gets a reset link: an unverified one gets the verification mail instead, with the same `202`, so word the confirmation the way the server does ("if an account exists..."), never "a reset mail is on its way".
- `emailVerified` is `false` until the address is verified: that is what the "verify your email" banner reads. Nothing in the app is blocked for an unverified user; only password reset needs a verified address.
- A `401` from `POST /account/password` or `DELETE /account/me` means a wrong password, not a lost session (see "How the frontend talks to the server").
- Avatars are plain URL strings (`http:` or `https:`) and there is no upload endpoint, so avatars show initials or a placeholder when `avatarUrl` is `null`, and for now also in place of an upload. Changing the email or the phone number is not supported.

#### Rooms and members

| Action | Admin | Member |
| --- | :---: | :---: |
| Send, read, edit own, delete own messages | yes | yes |
| List members, mark as read, leave | yes | yes |
| Rename the room or change its avatar, delete the room, add members, remove others, promote or demote | yes | no |

- Nobody edits or deletes another member's message, admins included.
- A direct room has exactly two members, both admins, and no name or avatar of its own. Its members cannot add or remove anyone, rename it or delete it; each can only leave it. Anything else answers `403`.
- Start a direct chat from the friends list with `POST /chat` and `type: 'direct'`: it answers `200` with the existing room when there is one and `201` with a new one, so use the returned `id` either way. Two people who are no longer friends get `403`, not their old room back, but the old room keeps working for them.
- Rooms are created and members added only from the requester's friends. A group room with no `member_ids` is allowed (the creator is its only member and its admin).
- Group names are 1 to 100 characters after trimming, on create and on update alike (`400` otherwise). An avatar must be an `http:` or `https:` URL (`null` clears it on update), but only update checks that: create accepts any string, so the form has to enforce the URL rule itself.
- `POST /chat` and `PATCH /chat/:chatid` answer with the room as stored, not as a summary: a direct room's `name` and `avatarUrl` are `null` there. After either, invalidate or merge into `GET /chat` instead of writing the response over a `ChatRoomSummary`.
- Leaving is `DELETE /chat/:chatid/member/:userid` with your own id. A group's only admin cannot leave while others remain (`409`): promote someone first. When the last member leaves, the room disappears from the API (the server deletes it after a retention period).
- Adding a member who already belongs is not an error: their id comes back in `alreadyMemberIds`. A member added to a room that already has messages starts with all of them read (`unreadCount` 0).

#### Messages

- `content` is trimmed and must be 1 to 4000 characters; a blank message is a `400`.
- `GET /chat/:chatid/message` returns the newest `limit` messages, newest first. For the next page pass `before` set to the id of the oldest message loaded; `hasMore` says whether older ones remain. Reverse the list for display.
- A deleted message stays in the list with `content: ""` and `deletedAt` set: show a placeholder such as "message deleted". An edited one has `editedAt`: show an "edited" label. Saving the content a message already has answers `200` without stamping `editedAt`. There is no edit history and no time limit.
- `sender` and `senderId` are `null` when the author deleted their account: show a placeholder name and no actions on that message.
- `lastMessage` of a room has no id and no sender, and it skips deleted messages. It changes when the newest message is edited or deleted.
- `unreadCount` counts the messages of other people, not deleted, above the requester's own `lastReadMessageId`. Mark as read with `PUT /chat/:chatid/read` and the id of the newest message loaded (`lastMessage` has no id to use). The marker only moves forward, so an out-of-order or repeated call is harmless and still `200`; after it set that room's `unreadCount` to 0 in the cache. `lastReadMessageId` of the other members is what a "seen by" indicator would be built from.

#### Friends

- Search by phone number: `GET /friend/search/:tel` accepts only the canonical form, `+` followed by up to 15 digits. Strip spaces, dashes and parentheses from what was typed before calling, and encode the path segment with `encodeURIComponent`. The search is an exact match, so it finds one person or nobody.
- `relationship` decides the button: `none` shows "Add friend", `request_sent` shows "Cancel" (`requestId`), `request_received` shows "Accept" (`requestId`), `friend` shows "Message", `self` shows nothing.
- The ids differ: `/friend/requests/:id...` takes a **request** id, `DELETE /friend/:id` a **user** id.
- Accepting or rejecting is not announced to the other person, and nothing is remembered: afterwards either can send a new request. Unfriending does not touch existing rooms.
- `GET /friend` and `GET /friend/requests` are not paginated yet.

### Limits that answer `429`

| Endpoint | Limit |
| --- | --- |
| `POST /account/login` | 10 per 15 minutes per IP |
| `POST /account/password`, `DELETE /account/me` | 10 per 15 minutes per user, shared by the two |
| `POST /account/email/verify`, `POST /account/password/reset` | 10 per 15 minutes per IP each |
| `POST /account/email/verification` | 5 per hour per user, and `Please wait a minute before asking for another email` while the last link is under 60 seconds old |
| `POST /account/password/reset-request` | 10 per 15 minutes per IP, and 3 per hour per email address |
| `GET /friend/search/:tel` | 30 per 15 minutes per user |
| `POST /friend/requests` | 20 per hour per user |

Requests answered `400` or `409` count too, so disable the submit button while a request is running: a double click should not spend the budget.

### Real-time events (planned, step 6)

The socket is a notification layer on top of REST: it never writes data, and every event has the same effect as refetching the matching endpoint. The server's design is under "Real-time events" in `./backend.doc.md`. Known so far: the handshake uses the session cookie (reached through `/socket.io` on the dev proxy); a socket joins `user:<id>` and one `chat:<chatId>` per room; `message:updated` carries the same message as the `PATCH` response, and `message:deleted` is `{ chatId, messageId, deletedAt }`. The other payloads are fixed in step 6, when the server side is written, and go into this section then.

## Implementation steps

### Step 1 — scaffold (done)

See "Current Implementation Status".

### Step 2 — account screens

- Sign-up form (hints, server errors, then a "check your email" notice; signup does not sign in), forgot-password form, `/verify-email` and `/reset-password` pages as described above.
- A "verify your email" banner in the `_app` header when `emailVerified` is `false`, with a resend button (`POST /account/email/verification`; show the `409` and `429` messages).
- Replace the thin login page: links to the other forms, and the verification notice.

### Step 3 — chat core

- Room list in a sidebar from `GET /chat` (`lastMessage`, `unreadCount`), the open conversation at `/chat/$chatId`.
- Messages with `useInfiniteQuery`: pages arrive newest first, `getNextPageParam` is the oldest id when `hasMore`, and the list is reversed for display. Keep the scroll position when older messages are prepended (the fiddly part: budget time for it).
- Send, edit and delete (sender only). On success, put the message the API returned into the cache; no refetch.
- Mark as read: `PUT /chat/:chatid/read` while a room is open and its latest message is in view; update `unreadCount` in the room list's cache.
- Until step 6, give the messages query a `refetchInterval` so the screen feels alive. Step 6 removes it.
- Stop here for a day and use it: this is where the API's shapes get tested for real.

### Step 4 — friends

- Search by phone number (`GET /friend/search/:tel`), send a request, the lists of incoming and outgoing requests, accept, reject, cancel, the friend list, unfriend, and "message" from a friend (creates or reuses the direct room).

### Step 5 — account settings and room management

- `/settings`: change name and avatar URL (`PATCH /account/me`), change password (`POST /account/password`), delete account (`DELETE /account/me`; show the rooms from the `409`'s `chatIds`).
- Create a group room, the member list, add and remove members, promote and demote, leave, rename. Show actions according to the permission table in "API contract", and rely on the server's answers for the rest.

### Step 6 — Socket.io, together with the server

Server and client are written in the same step, so each event can be tried as soon as it exists. The server side is specified under "Real-time events" in `./backend.doc.md`: the socket is a notification layer on top of REST and never a second way to write data.

Client side:

- One socket for the signed-in session, created in the `_app` layout and closed on sign-out. It connects through the same origin (add `'/socket.io': { target, ws: true }` to the dev proxy), so the handshake carries the session cookie.
- Every event updates the cache through the same functions the mutations use:

| Event | Cache update |
| --- | --- |
| `message:new` | add to that room's messages (by id), update the room's `lastMessage`; if the room is not open, `unreadCount` + 1, if it is open, mark it read |
| `message:updated` | replace the message by id |
| `message:deleted` | set `deletedAt` and clear the content of the message; refresh the room's `lastMessage` |
| `chat:updated` | update the room in the list and in its detail |
| `chat:removed` | remove the room from the caches; leave the page if it is open |
| `member:added`, `member:removed`, `member:role_changed` | invalidate that room's members query |
| `read:updated` | update the read markers if they are shown |
| `friend:request`, `friend:accepted` | invalidate the friend and request queries |

- On every reconnect, invalidate the active queries: events sent while the socket was down are gone.
- Typing indicators are socket-only: held in UI state with a timeout, never cached or stored.

### Step 7 — design, polish, deployment

- Visual design (see "Open questions"), empty and error states, keyboard use, mobile layout.
- Production setup as described in "How the frontend talks to the server".

## Testing

- `npm test` runs Vitest. No database and no server are needed.
- Unit tests cover the logic that can be wrong without anything looking wrong: the fetch wrapper (the request it really builds, `204`, error bodies, a lost connection, cancellation), the query client's retry and 401 rules, the guards and `safeRedirectPath`. They run the real code against a stubbed `fetch`.
- `src/app.test.tsx` runs the real router, guards, query client and screens in jsdom against a fake API, for the loops no unit test sees: signed-out visitor to login and back to the page they wanted, wrong credentials, off-site `redirect` ignored, sign-out clearing the cache, a session ending while a page is open, and a 401 that must not sign anyone out. Each new screen with a flow of that kind gets a test there.
- The aim is not full coverage: tests are for behaviour that matters and is easy to break. When a test is written for a new rule, break the code on purpose once and check that the test fails.
- Not tested: how it looks.
- A runaway navigation loop shows up in the app test as a worker that dies after about half a minute ("JavaScript heap out of memory"), with `Not implemented: Window's scrollTo()` repeated before it.

## Decisions

- **Dev proxy instead of CORS.** One origin in development, the same shape as production. CORS stays a later option.
- **`/api` prefix** in the browser, stripped by the proxy: the server keeps its route names.
- **`strictPort` on 5173**, because the mails link there.
- **`me` returns `user: null`** and is the single source of "who is signed in", cached for 5 minutes and rechecked on any 401.
- **No blanket sign-out on 401** (see "How the frontend talks to the server").
- **`_guest` layout, but `/verify-email` and `/reset-password` outside it,** because the email links must work in both states.
- **Redirect after login** through `safeRedirectPath`; plain `/login` after a deliberate sign-out.
- **TanStack Router file-based routing, `routeTree.gen.ts` committed.**
- **Vitest 5** in the frontend (the server uses Vitest 4): Vitest 5 installed cleanly next to Vite 8, while installing Vitest 4 there failed with an npm error in the sandbox this was built in. Align the two later if it matters.
- **Hand-written API types** per feature for now.
- **The API contract lives in this document too**, as a condensed copy of `./backend.doc.md`: frontend work should not need the 100 KB backend doc. The cost is two places to keep in step, so an endpoint change updates both in the same patch.
- **Plain CSS** in step 1; no styling library until the first real screens.

## Open questions

- Styling: plain CSS with a small set of tokens, or a utility library such as Tailwind. To be decided with step 2.
- ESLint and Prettier: neither the server nor the frontend has them yet.
- Optimistic updates for sending a message (show it at once, mark it failed if the request fails): worth it after step 3 has been used for a while.
- Long conversations: virtualized message list if scrolling gets slow.
- Pagination for `GET /chat` and `GET /friend` once the lists can grow (the server notes this already).
- Browser notifications and an unread count in the tab title.
- Shared types between server and frontend.
