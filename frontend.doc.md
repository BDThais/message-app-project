# Message App Frontend Planning & Progress

## Overview

This is the plan and progress log for the React frontend in `frontend/`. The backend (API, database, tests) is documented in `./backend.doc.md`; the API is specified in `./api.doc.md` (request and response shapes, status codes, error texts, rate limits), which is what frontend work needs from the server; this document covers the frontend.

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

Completed (step 2, "account screens"):

- Sign-up (`/signup`: hints, the server's error text, then a "check your email" notice; signup does not sign in), forgot-password (`/forgot-password`), and the two pages behind the mailed links (`/verify-email`, `/reset-password`)
- The login page now links to sign-up and forgot-password; it is `features/account/components/LoginForm.tsx` and the route file only passes it the `redirect` parameter
- A "verify your email" banner in the `_app` layout while `emailVerified` is `false`, with the resend button (`POST /api/account/email/verification`; the `409` and `429` texts are shown, and a `409` makes the app ask for `me` again)
- `src/components/ui/TextField.tsx`: a labelled input with a hint wired to it (the first shared component)
- `src/features/account/fragmentToken.ts`: reads the token from the URL fragment once and takes the fragment out of the address bar (see "Routing and authentication")
- `src/testing/`: the fake API and the render helper that the app-level tests share; the screens' tests are in `src/accountScreens.test.tsx`

Still planned:

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

**Development.** The browser only talks to the Vite dev server. Requests to `/api/...` are forwarded to `http://localhost:3000/api/...` unchanged: the server's routes start with `/api` themselves. So the session cookie is a first-party cookie, and no CORS configuration is needed. The prefix keeps the API's paths (`/api/account`, `/api/chat`, `/api/friend`) from colliding with the names of pages (`/chat/:chatId`).

**Cookie.** The session cookie is `HttpOnly`, `SameSite=Lax`, and `Secure` in production (`middlewares/SessionCookie.ts`). The frontend never reads it. Every request is sent with `credentials: 'include'`.

**Production (planned, step 7).** Serve the built frontend and route `/api` (and later `/socket.io`) to the API from the same origin, for example with a reverse proxy. With `SameSite=Lax` the frontend and the API have to be on the same site anyway. Two server-side consequences:

- CORS is only needed if the two end up on different origins. Then `cors` has to be added (see "Cookie / CORS Notes" in `./backend.doc.md`) and the cookie changed to `SameSite=None; Secure`, as the comment in `SessionCookie.ts` says.
- Behind a reverse proxy, every request arrives from the proxy's address unless Express is told to trust the proxy's `X-Forwarded-For` header (`app.set('trust proxy', ...)`; `app.ts` does not set it today). The rate limiters key on the IP, so without it all users would share one limit.

**Errors.** `api` throws an `ApiError` (`status`, `message`, `body`) for every non-2xx answer. `message` is the server's `{ error }` text, `body` keeps the whole parsed body for the few errors that carry more (`chatIds` on the `409` of `DELETE /api/account/me`). A request that never got an answer is an `ApiError` with status `0`. Endpoints that answer `204` resolve to `undefined`.

**A 401 does not always mean "signed out".** `POST /api/account/password` and `DELETE /api/account/me` answer `401` for a wrong password with the session still fine, and login answers `401` for bad credentials. So the query client does not sign anyone out on a 401: it calls `onUnauthorized` (set in `createApp.ts`), which refetches `GET /api/account/me`. That endpoint answers `user: null` when the session really is gone, and the `_app` layout then sends the person to `/login`.

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
    ├── accountScreens.test.tsx   // signup, forgot/reset password, the mailed-link pages, the banner (same approach)
    ├── routes/                   // thin: URL, guard, and which feature components to show
    │   ├── __root.tsx            // router context type, not-found page
    │   ├── index.tsx             // "/" -> /chat
    │   ├── _guest.tsx            // layout: signed-in users are sent to /chat
    │   ├── _guest/login.tsx
    │   ├── _guest/signup.tsx
    │   ├── _guest/forgot-password.tsx
    │   ├── verify-email.tsx      // outside both layouts: the mailed link works signed in or out
    │   ├── reset-password.tsx    // same
    │   ├── _app.tsx              // layout: signed-out users are sent to /login; header with sign-out; verify-email banner
    │   └── _app/chat.index.tsx   // placeholder
    ├── components/
    │   └── ui/TextField.tsx      // label + input + hint, wired together
    ├── features/
    │   └── account/
    │       ├── types.ts          // User, LoginInput, SignupInput, ResetPasswordInput
    │       ├── api.ts            // one function per endpoint, no React
    │       ├── queries.ts        // query keys, queryOptions, hooks, recheckSession
    │       ├── guards.ts         // beforeLoad helpers, safeRedirectPath
    │       ├── guards.test.ts
    │       ├── fragmentToken.ts  // parseFragmentToken, useFragmentToken
    │       ├── fragmentToken.test.ts
    │       ├── hints.ts          // texts that hint the server's rules (password)
    │       └── components/       // LoginForm, SignupForm, ForgotPasswordForm, ResetPasswordForm, VerifyEmailPage, VerifyEmailBanner
    ├── testing/
    │   ├── fakeApi.ts            // the fake server (a stubbed fetch) with the account endpoints
    │   └── renderApp.tsx         // the real app in memory, optionally in StrictMode
    └── lib/
        ├── http.ts               // api, ApiError
        ├── http.test.ts
        ├── queryClient.ts        // createQueryClient, shouldRetry
        └── queryClient.test.ts
```

Planned additions: `features/chats/`, `features/messages/`, `features/friends/` (each with `types.ts`, `api.ts`, `queries.ts`, `components/`), more of `components/ui/` (buttons, avatar, dialog), and `lib/socket.ts` (step 6).

## Conventions

- **Feature folders**, mirroring the server's `modules/`: everything for one feature lives under `src/features/<feature>/`. Route files stay thin.
- **`api.ts` has the only mention of a URL path.** Components never call `fetch` or `api` directly: they use hooks from `queries.ts`.
- **One query-key factory per feature** (`accountKeys.me()`, later `chatKeys.list()`, `chatKeys.messages(chatId)`), so no key is typed by hand in two places.
- **Cache updates go through functions** (`setSignedInUser`, later `addMessageToCache`, `removeChatFromCache`). Mutations and socket handlers call the same function, and such a function must be idempotent by id, so a message that arrives twice (the sender's own REST response and the socket event) is stored once.
- **Whatever the server decides, the server decides.** Client-side checks (a password hint, a required field) exist to save a round trip, never to replace the server's validation. Show the server's `{ error }` text.
- **TypeScript:** `strict` and `noUncheckedIndexedAccess`, like the server. `exactOptionalPropertyTypes` is off here because React's and TanStack's own types do not follow it.
- **Types of API responses are written by hand** in each feature's `types.ts`, from the shapes in `./api.doc.md`. A shared package or generated types can come later if keeping them in step becomes a chore.
- **Files:** components `PascalCase.tsx`, everything else `camelCase.ts`, tests next to the file as `<file>.test.ts(x)`.

## Routing and authentication

| Path | File in `src/routes/` | Layout and rule | Status |
| --- | --- | --- | --- |
| `/` | `index.tsx` | redirects to `/chat` | done |
| `/login` | `_guest/login.tsx` | `_guest`: a signed-in user is sent to `/chat` | done |
| `/signup` | `_guest/signup.tsx` | `_guest` | done |
| `/forgot-password` | `_guest/forgot-password.tsx` | `_guest` | done |
| `/verify-email` | `verify-email.tsx` | none: works signed in or out | done |
| `/reset-password` | `reset-password.tsx` | none: works signed in or out | done |
| `/chat` | `_app/chat.index.tsx` | `_app`: a signed-out visitor is sent to `/login` | placeholder |
| `/chat/$chatId` | `_app/chat.$chatId.tsx` | `_app` | step 3 |
| `/friends` | `_app/friends.tsx` | `_app` | step 4 |
| `/settings` | `_app/settings.tsx` | `_app` | step 5 |

How the guards work:

- `_app` runs `requireUser` in `beforeLoad`: it asks the cache for `me` (one `GET /api/account/me` the first time, then whatever the cache holds: the guards use `queryClient.query` with `staleTime: 'static'`, the replacement for the deprecated `ensureQueryData`, so a navigation never waits for the server; the `_app` layout's own `useMe` refreshes the answer after 5 minutes or when it is invalidated, and `recheckSession` drops it) and redirects to `/login?redirect=<where they were going>` when nobody is signed in. Because it runs before the route renders, no page behind it ever starts a request without a session.
- `_guest` runs `redirectIfSignedIn`, so a signed-in user who opens `/login` lands on `/chat`.
- `/verify-email` and `/reset-password` are plain top-level routes: the links in the emails must work whether or not the person happens to be signed in.
- Both pages read the token from `location.hash` with `useFragmentToken`: it reads the token once into component state and then replaces the history entry with the same URL without the fragment, so the token is not left in the address bar or the browser history. The token lives on in state, which is what lets the reset form resend after a refused password (the server checks the password before it uses up the link). A reload therefore loses the token: the person opens the mailed link again.
- `/verify-email` posts the token as soon as it opens (a `POST`, never a `GET`), once: a ref guards the effect because StrictMode runs effects twice in development and a link works only once (the app-level test runs it in StrictMode). A successful verification or reset calls `recheckSession`, which resets the cached `me`: the link can belong to another account than the one signed in, and a reset deletes every session of the account, so the cache cannot patch itself.
- After signing in, the login page goes to the `redirect` parameter, but only through `safeRedirectPath`: it must start with a single `/`. Anything else (`https://...`, `//host`, `/\host`) falls back to `/chat`, so a crafted login link cannot send people to another site.
- A guard only runs on navigation. When the session ends while a page is open (a request answers 401 and `me` then comes back empty), the `_app` layout notices that the cached user became `null` and navigates to `/login?redirect=...`. Signing out on purpose goes to plain `/login`. The layout reads the current location once, inside the effect: a hook that follows the location would run the effect again for the `/login` URL it has just navigated to and nest the `redirect` parameter without end (the app-level test caught exactly this).
- Signing in or out replaces the whole cache except `me` (`setSignedInUser`), so the next person at this tab never sees the previous user's rooms or messages.

## Using the API from the screens

The API itself (every endpoint's request, response, status codes, error texts, rate limits, and the rules that come with them) is specified in `./api.doc.md`; the types in each feature's `types.ts` are written from its "Shapes" section. What follows is only how the screens are meant to use it.

### Account

- Signup form: hint the rules from `./api.doc.md` (name, password, phone number), but show the server's `error` text rather than rebuilding it: client-side checks only save a round trip. A new account has no avatar, so the avatar field belongs to the profile screen, not to signup.
- The "verify your email" banner reads `emailVerified` and offers the resend button; nothing else in the app is blocked for an unverified user. `me` is cached for 5 minutes, so an address verified in another tab or on a phone still shows the banner until then; the resend button's `409 Email is already verified` makes the app fetch `me` again, and the banner goes away.
- The page behind a mailed link reads the token from `location.hash`, posts it, and removes it from the address bar. The reset form words its confirmation like the server does ("if an account exists..."), never "a reset mail is on its way".
- There is no avatar upload, so show initials or a placeholder when `avatarUrl` is `null`. An avatar is a pasted `http:` or `https:` URL, and the server refuses anything else on every endpoint that takes one.

### Rooms and members

- Start a direct chat from the friends list with `POST /api/chat` and use the returned `id`, whether it answered `200` or `201`. Two people who are no longer friends get a `403` there, but their old room keeps working from the room list.
- `POST /api/chat` and `PATCH /api/chat/:chatid` return the room as stored, not a summary: merge them into the cached room list or invalidate `GET /api/chat`, and for a direct room show the other member from `members`.
- Show room actions according to the permission table in `./api.doc.md`, and rely on the server's answers for the rest. A group's only admin cannot leave while others remain (`409`): offer to promote someone first.

### Messages

- `GET /api/chat/:chatid/message` is newest first: reverse it for display, and page back with `before` set to the oldest id loaded.
- Show a placeholder such as "message deleted" for a deleted message, an "edited" label for `editedAt`, and a placeholder name with no actions when `sender` is `null`.
- Mark a room as read with the id of the newest message loaded (`lastMessage` has no id to use), then set that room's `unreadCount` to 0 in the cache.

### Friends

- Strip spaces, dashes and parentheses from the typed phone number before `GET /api/friend/search/:tel`, and encode the segment with `encodeURIComponent`: the server accepts only the canonical form.
- `relationship` decides the button: `none` shows "Add friend", `request_sent` shows "Cancel" (`requestId`), `request_received` shows "Accept" (`requestId`), `friend` shows "Message", `self` shows nothing.
- `/api/friend/requests/:id...` takes a request id, `DELETE /api/friend/:id` a user id.

### Forms that hit a rate limit

- Disable the submit button while a request is running: the limiters count every request, including the ones that fail validation, so a double click spends the budget.

## Implementation steps

### Step 1 — scaffold (done)

See "Current Implementation Status".

### Step 2 — account screens (done)

- Sign-up form (hints, server errors, then a "check your email" notice; signup does not sign in), forgot-password form, `/verify-email` and `/reset-password` pages as described above.
- A "verify your email" banner in the `_app` header when `emailVerified` is `false`, with a resend button (`POST /api/account/email/verification`; show the `409` and `429` messages).
- Replace the thin login page: links to the other forms, and the verification notice.

Built as described. Where the plan was open: the "verification notice" is the sign-up screen's "check your email" notice (it says that signing in does not wait for verification and that the banner resends the mail) plus a note on the forgot-password confirmation (an unverified address gets a verification mail instead of a reset mail). The forgot-password confirmation says "if an account exists", like the server, and never "a mail was sent". The server stores and matches an email address without regard to case (it lower-cases it), so the forms say nothing about case and the client never changes the address.

### Step 3 — chat core

- Room list in a sidebar from `GET /api/chat` (`lastMessage`, `unreadCount`), the open conversation at `/chat/$chatId`.
- Messages with `useInfiniteQuery`: pages arrive newest first, `getNextPageParam` is the oldest id when `hasMore`, and the list is reversed for display. Keep the scroll position when older messages are prepended (the fiddly part: budget time for it).
- Send, edit and delete (sender only). On success, put the message the API returned into the cache; no refetch.
- Mark as read: `PUT /api/chat/:chatid/read` while a room is open and its latest message is in view; update `unreadCount` in the room list's cache.
- Until step 6, give the messages query a `refetchInterval` so the screen feels alive. Step 6 removes it.
- Stop here for a day and use it: this is where the API's shapes get tested for real.

### Step 4 — friends

- Search by phone number (`GET /api/friend/search/:tel`), send a request, the lists of incoming and outgoing requests, accept, reject, cancel, the friend list, unfriend, and "message" from a friend (creates or reuses the direct room).

### Step 5 — account settings and room management

- `/settings`: change name and avatar URL (`PATCH /api/account/me`), change password (`POST /api/account/password`), delete account (`DELETE /api/account/me`; show the rooms from the `409`'s `chatIds`).
- Create a group room, the member list, add and remove members, promote and demote, leave, rename. Show actions according to the permission table in `./api.doc.md`, and rely on the server's answers for the rest.

### Step 6 — Socket.io, together with the server

Server and client are written in the same step, so each event can be tried as soon as it exists. The events are specified in `./api.doc.md` ("Real-time events") and the server side is described in `./backend.doc.md`: the socket is a notification layer on top of REST and never a second way to write data.

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
- `src/app.test.tsx` runs the real router, guards, query client and screens in jsdom against a fake API, for the loops no unit test sees: signed-out visitor to login and back to the page they wanted, wrong credentials, off-site `redirect` ignored, sign-out clearing the cache, a session ending while a page is open, and a 401 that must not sign anyone out. Each new screen with a flow of that kind gets a test in a file like this one: `src/accountScreens.test.tsx` has signup, forgot and reset password, the mailed-link pages (token posted once in StrictMode, token removed from the URL) and the banner. The fake API (`src/testing/fakeApi.ts`) follows `./api.doc.md`; when an endpoint's shape changes there, change the fake in the same patch.
- The aim is not full coverage: tests are for behaviour that matters and is easy to break. When a test is written for a new rule, break the code on purpose once and check that the test fails.
- Not tested: how it looks.
- A runaway navigation loop shows up in the app test as a worker that dies after about half a minute ("JavaScript heap out of memory"), with `Not implemented: Window's scrollTo()` repeated before it.

## Decisions

- **Dev proxy instead of CORS.** One origin in development, the same shape as production. CORS stays a later option.
- **`/api` prefix** on every API path, on the server as well as in the browser: the proxy forwards requests unchanged, so an endpoint has one path everywhere (it used to be stripped by the proxy).
- **`strictPort` on 5173**, because the mails link there.
- **`me` returns `user: null`** and is the single source of "who is signed in", cached for 5 minutes and rechecked on any 401.
- **No blanket sign-out on 401** (see "How the frontend talks to the server").
- **`_guest` layout, but `/verify-email` and `/reset-password` outside it,** because the email links must work in both states.
- **Redirect after login** through `safeRedirectPath`; plain `/login` after a deliberate sign-out.
- **TanStack Router file-based routing, `routeTree.gen.ts` committed.**
- **Vitest 5** in the frontend (the server uses Vitest 4): Vitest 5 installed cleanly next to Vite 8, while installing Vitest 4 there failed with an npm error in the sandbox this was built in. Align the two later if it matters.
- **Hand-written API types** per feature for now.
- **The API specification has its own document**, `./api.doc.md`, that this document and `./backend.doc.md` both point to, so an endpoint change is made in one place. The backend doc keeps how the endpoints are built.
- **Plain CSS** in step 1; no styling library until the first real screens. Step 2 still used plain CSS (a few classes in `styles.css`); see "Open questions".
- **The mailed-link pages read the token once into state and strip the fragment** (see "Routing and authentication"), and `recheckSession` resets `me` after a verification or a reset instead of patching the cached user.
- **Signup shows a notice, not a sign-in.** The server does not sign anyone in at signup; the notice does not promise the mail (a mail that cannot be sent does not fail the request) and points to the banner's resend button.

## Open questions

- Styling: plain CSS with a small set of tokens, or a utility library such as Tailwind. Not decided in step 2, which stayed with a few plain classes; decide before step 3 grows the CSS, or leave it to step 7.
- ESLint and Prettier: neither the server nor the frontend has them yet.
- Optimistic updates for sending a message (show it at once, mark it failed if the request fails): worth it after step 3 has been used for a while.
- Long conversations: virtualized message list if scrolling gets slow.
- Pagination for `GET /api/chat` and `GET /api/friend` once the lists can grow (the server notes this already).
- Browser notifications and an unread count in the tab title.
- Shared types between server and frontend.
