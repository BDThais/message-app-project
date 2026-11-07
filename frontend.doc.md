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
- Styling: Tailwind CSS v4 (`tailwindcss`, `@tailwindcss/vite`); see "Styling"

Node `^20.19.0 || >=22.12.0` is required (Vite 8).

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

## Styling

Tailwind CSS v4, through its Vite plugin (`@tailwindcss/vite` in `vite.config.ts`). The idea in one paragraph: Tailwind has one small class for one CSS declaration (`p-4` is `padding: 1rem`, `flex` is `display: flex`, `text-muted` is a color), and a component lists the ones it needs in `className`. At build time Tailwind reads the class names in `src/` and writes a stylesheet with only the rules that are used. No per-component stylesheet has to be named, found, or kept in step with the markup.

Why this and not plain CSS or CSS Modules (decided 2026-10-24):

- The screens of this app are mostly layout and states: rows and columns, hover, focus and disabled, a light and a dark theme, a phone layout. A utility says each of those in a few characters at the place it applies (`sm:p-6`, `enabled:hover:bg-sunken`); a stylesheet needs a class name, a rule and a media query for each.
- The styles live in the component, so a component that is moved or deleted takes its styles along. The single `styles.css` of steps 1 and 2 could only grow, and its header comment was already out of date.
- Spacing, sizes and radii come from a fixed scale, which keeps screens designed by a developer without a designer consistent.
- It is a build step and no runtime: the result is one CSS file. v4 needs no config file (it is configured in CSS) and has a first-party Vite plugin.
- Not chosen: CSS Modules, the runner-up (no dependency and scoped names, but a second file and a second set of names per component, and dark mode and breakpoints written by hand each time); CSS-in-JS libraries such as styled-components or Emotion (they work out the styles in the browser while the app runs); vanilla-extract (type-safe, but a new way of writing and a build step for an app this size). For dialogs and menus in step 5 a headless component library can be added on top of Tailwind.
- The price: long class lists (which is what the shared components below are for), and a class that does not exist gives no style and no error.

Rules:

- **Colors come from tokens,** declared once in `@theme` in `styles/theme.css` with the light value and the dark value side by side (`light-dark(#fff, #171a21)`): `bg-surface`, `text-muted`, `border-edge`, `bg-accent`, `text-danger`. A component never uses a palette color (`bg-white`, `text-zinc-500`) and never needs a `dark:` variant: the dark theme is the second value of the token. A new color is a new token.
- **The theme is the system's** (`color-scheme: light dark`), with no toggle. To see the other one: browser developer tools, Rendering, "Emulate CSS media feature prefers-color-scheme".
- **A look that is used twice is a component in `components/ui/`,** not a repeated class string and not `@apply`. `Button`, `Notice`, `Form`, `FormLinks`, `TextField`, `TextArea`, `Avatar`, `Page` and `Logo` have no `className` prop on purpose: the look is the same everywhere, spacing around a component is its parent's job, and a missing look is added to the component as a variant.
- **`src/styles/` holds only what a class name cannot say,** one file per concern, all imported by `index.css` (the one file `main.tsx` imports; Tailwind comes first, because the files after it use its theme and its `@apply`). Today that is `theme.css` (the `@theme` tokens) and `base.css` (the `@layer base` rules for bare elements: body colors, `h1`, links, the focus ring). A new concern is a new file and one `@import` line in `index.css` (custom `@utility` and `@custom-variant` definitions, the overrides for a third-party widget), not more lines in an existing file. A component's own look is never here: it is its classes, or a shared component in `components/ui/`. Every page has one `h1` and none sets its size.
- **Two utilities for the same property are decided by the order of the stylesheet, not by the order in `className`.** A component that varies a property gets it from its lookup object only: the sizes of `Button` carry their own `text-sm` or `text-xs`, and the shared classes carry none, because a `text-xs` next to a shared `text-sm` would win or lose by luck.
- **A class name is written out in full in the source.** Tailwind finds classes by reading the text of the files, so `bg-${tone}` is never found; a lookup object (`tones` in `Notice`) is how a class varies.
- **Contrast:** every text and background pair of the tokens is at least 4.5:1, and the border of a control against its card at least 3:1, in both themes (checked on 2026-10-24 on the values in `styles/theme.css`, and on 2026-10-25 for the pairs the chat screens added: the message bubbles, the muted text on the open room, the `ghost` and `danger` buttons). Check the pairs again when a color changes.
- **`light-dark()` is compiled by `vite build`** into a pair of variables (`--lightningcss-light` and `--lightningcss-dark`) for older browsers, while `npm run dev` keeps it as written. When a color looks wrong, look at both (`npm run build`, then `npm run preview`).
- **A mistyped class shows nothing.** `npm run build`, then search `dist/assets/*.css` for the class with its `:` and `/` escaped with a backslash (`enabled\:hover\:bg-sunken`); a lint rule would do it for good (see "Open questions").
- **Layout:** the signed-in shell is exactly as high as the window (`h-dvh`), the header and the banner on top, and the page below them in an area that scrolls (`min-h-0 flex-1 overflow-y-auto`), so a page that is taller than the window (`Page` with `layout="column"`) scrolls there. A page that scrolls inside itself (the chat) uses `layout="fill"`: its `<main>` takes the room that is left and its parts say `min-h-0` and `overflow-y-auto` themselves. A flex child does not shrink below its content unless it says `min-h-0`, which is what makes a message list scroll instead of growing.
- **The message list has `[overflow-anchor:none]`.** Chrome and Firefox keep the visible messages in place when messages are added above them, Safari does not; `useMessageScroll` does it for every browser, and left alone with the browser's own, the two corrections add up to a jump.

## Project structure

```text
frontend/
├── .env.example                  // API_PROXY_TARGET for the dev proxy
├── .gitignore
├── index.html
├── package.json
├── public/
│   └── favicon.svg
├── tsconfig.json                 // the app: src/ and test/, browser types, the @/ and @contract/ aliases
├── tsconfig.node.json            // vite.config.ts and vitest.config.ts, Node types
├── vite.config.ts                // router plugin, React plugin, Tailwind plugin, the @/ and @contract/ aliases, port 5173, /api proxy
├── vitest.config.ts              // test settings: runs test/**/*.test.ts(x), the two aliases; kept apart so tests skip the router plugin and the proxy
├── test/                         // every test and its helpers, mirroring src/ (like the server's test/)
│   ├── app.test.tsx              // the sign-in loop through the real app against a fake API
│   ├── accountScreens.test.tsx   // signup, forgot/reset password, the mailed-link pages, the banner (same approach)
│   ├── chatScreens.test.tsx      // the room list, a conversation, sending, editing, deleting, older messages, the read marker, scrolling (same approach)
│   ├── friendsScreens.test.tsx   // searching, the requests, the friend list, "Message", the main navigation (same approach)
│   ├── pageFrame.test.tsx        // every page has exactly one <main>
│   ├── structure.test.ts         // the folder rules: no test in src/, who may import whom, the only way into server/ (@contract/, import type)
│   ├── helpers/
│   │   ├── fakeApi/              // the fake server (a stubbed fetch), one file per feature
│   │   │   ├── index.ts          // stubApi: the stubbed fetch, tries each feature's endpoints in turn
│   │   │   ├── state.ts          // the fake server's state, shared by the features; John, Bea, Carl and Dana, the passwords, the rooms and messages, the friends and their requests
│   │   │   ├── account.ts        // the account endpoints
│   │   │   ├── chats.ts          // the chat endpoints: rooms (the list, a direct room made or found), messages (page, send, edit, delete), the read marker
│   │   │   ├── friends.ts        // the friend endpoints: search, the requests (list, send, accept, delete), the friend list, unfriend
│   │   │   ├── body.ts           // textField, numberField: read the request body (its values are `unknown`, as on the wire)
│   │   │   └── responses.ts      // json(), noContent()
│   │   └── renderApp.tsx         // the real <App> in memory, optionally in StrictMode
│   ├── components/ui/
│   │   ├── Avatar.test.tsx
│   │   └── ListState.test.tsx
│   ├── features/account/
│   │   ├── guards.test.ts
│   │   └── fragmentToken.test.ts
│   ├── features/friends/
│   │   ├── cache.test.ts         // idempotent by id, the order of the friends, one request in one list, a person changed in every cached search
│   │   └── tel.test.ts           // what a typed number becomes before the search
│   ├── features/chats/
│   │   ├── cache.test.ts         // idempotent by id, the preview and the order of the room list, the merge of the newest page, a room from POST /api/chat
│   │   ├── format.test.ts
│   │   ├── parseChatId.test.ts
│   │   └── useMessageScroll.test.ts  // the arithmetic of keeping the position
│   └── lib/
│       ├── http.test.ts
│       └── queryClient.test.ts
└── src/
    ├── main.tsx                  // mounts <App> in StrictMode, with the query devtools
    ├── App.tsx                   // the providers around the router; main.tsx and the tests' renderApp both render it
    ├── createApp.ts              // builds the query client and the router and connects them; also used by tests
    ├── router.tsx                // router settings and the type registration
    ├── routeTree.gen.ts          // GENERATED by the router plugin; committed
    ├── styles/                   // all CSS; main.tsx imports index.css (see "Styling")
    │   ├── index.css             // the entry: tailwindcss first, then the two files below
    │   ├── theme.css             // @theme: the color tokens, the light and the dark value side by side
    │   └── base.css              // @layer base: the rules for bare elements (body, h1, links, the focus ring)
    ├── routes/                   // thin: URL, guard, and which feature components to show
    │   ├── __root.tsx            // router context type, not-found page
    │   ├── index.tsx             // "/" -> /chat
    │   ├── _guest.tsx            // layout: signed-in users are sent to /chat
    │   ├── _guest/login.tsx
    │   ├── _guest/signup.tsx
    │   ├── _guest/forgot-password.tsx
    │   ├── _public.tsx           // layout without a guard, draws the page frame: the mailed links work signed in or out
    │   ├── _public/verify-email.tsx
    │   ├── _public/reset-password.tsx
    │   ├── _app.tsx              // layout route: the requireUser guard, renders AppLayout
    │   ├── _app/chat.tsx         // layout of the chat pages: the room-list sidebar (ChatLayout)
    │   ├── _app/chat.index.tsx   // "select a chat", for wide screens
    │   ├── _app/chat.$chatId.tsx // the conversation; a path that is not a room id is "chat not found"
    │   └── _app/friends.tsx      // the friends page
    ├── components/
    │   └── ui/
    │       ├── Page.tsx          // the page frame: the <main>; layout narrow (a centered card), column, or fill (the room that is left)
    │       ├── Avatar.tsx        // the picture at a URL, or initials when there is none or it does not load
    │       ├── Logo.tsx          // the mark and the name
    │       ├── Button.tsx        // variant (primary, secondary, ghost, danger), size (md, sm, xs), fullWidth; no className
    │       ├── Notice.tsx        // tone (info, success, error) and the role the caller gives it
    │       ├── ListState.tsx     // what a list shows before it has items: loading, the server's error with a retry, or the empty text; the items stay when a refetch fails
    │       ├── Form.tsx          // <form> with the spacing between fields
    │       ├── FormLinks.tsx     // the row of links under a form or a notice
    │       ├── TextField.tsx     // label + input + hint, wired together
    │       └── TextArea.tsx      // the same for several lines; the label can be hidden for a screen reader only
    ├── features/
    │   ├── chats/
    │   │   ├── types.ts          // ChatRoomSummary, Message, MessageListResponse (from the contract)
    │   │   ├── keys.ts           // chatKeys (apart from queries.ts because cache.ts and queries.ts need each other's imports)
    │   │   ├── api.ts            // one function per endpoint, no React
    │   │   ├── cache.ts          // sortRooms, addRoomToCache, addMessageToCache, replaceMessageInCache, markMessageDeletedInCache, refreshPreviewAfterChange, markRoomReadInCache, mergeNewestPageIntoCache
    │   │   ├── queries.ts        // the room list and messages queries, the mutations (also the direct room "Message" makes), the polling of the newest page (until step 6)
    │   │   ├── useMessageScroll.ts   // the bottom, the position kept when older messages arrive, "is the newest message in view"
    │   │   ├── useMarkRoomRead.ts    // PUT .../read when there is something unread and it is in view
    │   │   ├── format.ts         // roomTitle, formatListTime, formatSentAt
    │   │   ├── parseChatId.ts    // the id in /chat/:chatId, or null
    │   │   └── components/       // ChatLayout, RoomList, Conversation, MessageItem, MessageEditor, ChatNotFound
    │   ├── friends/
    │   │   ├── types.ts          // FriendRequest, PublicUser, SearchResult, Relationship, FriendRequestDirection (from the contract)
    │   │   ├── keys.ts           // friendKeys (apart from queries.ts for the reason chatKeys is)
    │   │   ├── tel.ts            // normalizeTel: the typed number as the server wants it
    │   │   ├── api.ts            // one function per endpoint, no React
    │   │   ├── cache.ts          // sortFriends, addFriendToCache, removeFriendFromCache, addRequestToCache, removeRequestFromCache, setRelationshipInSearches
    │   │   ├── queries.ts        // the friend list, the two request lists and the search, the mutations
    │   │   ├── useMessageFriend.ts  // makes or finds the direct room with a friend and opens it
    │   │   └── components/       // FriendsPage, FindFriend, IncomingRequests, OutgoingRequests, FriendList, Section, PersonRow
    │   └── account/
    │       ├── types.ts          // User (from the contract), LoginInput and SignupInput (the contract's bodies), ResetPasswordInput
    │       ├── api.ts            // one function per endpoint, no React
    │       ├── queries.ts        // query keys, queryOptions, hooks, recheckSession
    │       ├── guards.ts         // beforeLoad helpers, safeRedirectPath
    │       ├── useRedirectWhenSignedOut.ts  // sends the person to /login when the session ends while a page is open
    │       ├── fragmentToken.ts  // parseFragmentToken, useFragmentToken
    │       ├── hints.ts          // texts that hint the server's rules (password)
    │       └── components/       // AppLayout (header with the main navigation, banner, outlet), LoginForm, SignupForm, ForgotPasswordForm, ResetPasswordPage, VerifyEmailPage, VerifyEmailBanner
    └── lib/
        ├── http.ts               // api, ApiError
        ├── queryClient.ts        // createQueryClient, shouldRetry
        └── useDocumentVisible.ts // false while the tab is in the background
```

Planned additions: more of `components/ui/` (dialog), and `lib/socket.ts` (step 6). `features/chats/` holds rooms, members, messages and read markers together, like the server's `chatrooms` module: they share one query-key factory, and the cache functions of a room and of its messages need each other (a new message changes the room's `lastMessage` and `unreadCount`; a removed room drops its messages), which two folders could only do by importing each other. `lib/socket.ts` only creates the connection. The code that applies an event to the cache belongs to the features (`features/chats/`, `features/friends/`), because `lib/` may not import from `features/`.

## Conventions

- **Feature folders**, mirroring the server's `modules/`: everything for one feature lives under `src/features/<feature>/`. Route files stay thin.
- **Imports outside the current feature or folder start with `@/`,** which is `src/` (`paths` in `tsconfig.json`, and `resolve.tsconfigPaths` in `vite.config.ts` and in `vitest.config.ts`: the two config files are separate, so each needs the line). Inside a feature, and between the files of one folder, imports stay relative (`../queries`, `./VerifyEmailBanner`), so a feature can be moved or renamed as a whole. A test imports what it tests with `@/` and `test/helpers/` with a relative path.
- **Imports go one way:** `routes/` use `features/`, and `features/` use `components/` and `lib/`. `lib/` and `components/` never import from `features/` or `routes/` (`test/structure.test.ts` checks it).
- **A component starts in the `components/` of the feature that needs it** and moves to `components/ui/` when a second feature needs it. `components/ui/` never imports from `features/` or `routes/`.
- **`api.ts` has the only mention of a URL path.** Components never call `fetch` or `api` directly: they use hooks from `queries.ts`.
- **One query-key factory per feature** (`accountKeys.me()`, `chatKeys.list()`, `chatKeys.messages(chatId)`), so no key is typed by hand in two places. `chatKeys` is in `keys.ts`, because `cache.ts` needs the keys and `queries.ts` needs `cache.ts`.
- **Cache updates go through functions** (`setSignedInUser`, `addMessageToCache`, `markRoomReadInCache`, later `removeChatFromCache`). Mutations and socket handlers call the same function, and such a function must be idempotent by id, so a message that arrives twice (the sender's own REST response and the socket event) is stored once.
- **Whatever the server decides, the server decides.** Client-side checks (a password hint, a required field) exist to save a round trip, never to replace the server's validation. Show the server's `{ error }` text.
- **TypeScript:** `strict` and `noUncheckedIndexedAccess`, like the server. `exactOptionalPropertyTypes` is off here because React's and TanStack's own types do not follow it.
- **The shapes of the API come from the server's contract,** `server/src/contract/` (see "API contract" in `./backend.doc.md`), imported as `@contract/...`: a second `paths` entry in `tsconfig.json`, with the same `resolve.tsconfigPaths` line in the two config files. A feature's `types.ts` re-exports what it needs from there (`User`) and keeps only what is the frontend's own (`ResetPasswordInput` has a camelCase `newPassword`). `api.ts` types each response with the contract (`api.get<MeResponse>(...)`) and each request body with `satisfies` (`{ token, new_password: newPassword } satisfies ResetPasswordBody`), so a key spelled differently on the server stops compiling. The only way into `server/` is `@contract/`, and only with `import type`: `import { type X }` still loads the file, and a value from the contract would need the dev server to serve a file outside `frontend/` (`test/structure.test.ts` checks both). The account, chats and friends features are on the contract, and so are the success bodies of the fake API in `test/helpers/`; every endpoint of the server is typed with it.
- **Comments follow the server's rule** ("Comments" in `./backend.doc.md`): only the reason a line has to stay the way it is. What a component or a hook does is in its name and in this document, and a route or a file name is not repeated in a comment.
- **A new screen is styled when it is written,** with the tokens and the shared components of `components/ui/` (see "Styling"); step 7 polishes, it does not start the styling.
- **Files:** components `PascalCase.tsx`, everything else `camelCase.ts`.
- **Tests live in `test/`, not next to the code**, in the same folders as the file they test (`src/lib/http.ts` is tested by `test/lib/http.test.ts`) and named `<file>.test.ts(x)`. What the app-level tests share (the fake API, the render helper) is in `test/helpers/`. Nothing in `src/` imports from `test/`, and no test file is left in `src/`: `test/structure.test.ts` fails if either happens.

## Routing and authentication

| Path | File in `src/routes/` | Layout and rule | Status |
| --- | --- | --- | --- |
| `/` | `index.tsx` | redirects to `/chat` | done |
| `/login` | `_guest/login.tsx` | `_guest`: a signed-in user is sent to `/chat` | done |
| `/signup` | `_guest/signup.tsx` | `_guest` | done |
| `/forgot-password` | `_guest/forgot-password.tsx` | `_guest` | done |
| `/verify-email` | `_public/verify-email.tsx` | `_public`: no guard, works signed in or out | done |
| `/reset-password` | `_public/reset-password.tsx` | `_public`: no guard, works signed in or out | done |
| `/chat` | `_app/chat.index.tsx` | `_app`: a signed-out visitor is sent to `/login`; then `_app/chat.tsx` | done |
| `/chat/$chatId` | `_app/chat.$chatId.tsx` | `_app`, then `_app/chat.tsx` | done |
| `/friends` | `_app/friends.tsx` | `_app` | done |
| `/settings` | `_app/settings.tsx` | `_app` | step 5 |

How the guards work:

- `_app` runs `requireUser` in `beforeLoad`: it asks the cache for `me` (one `GET /api/account/me` the first time, then whatever the cache holds: the guards use `queryClient.query` with `staleTime: 'static'`, the replacement for the deprecated `ensureQueryData`, so a navigation never waits for the server; the `_app` layout's own `useMe` refreshes the answer after 5 minutes or when it is invalidated, and `recheckSession` drops it) and redirects to `/login?redirect=<where they were going>` when nobody is signed in. Because it runs before the route renders, no page behind it ever starts a request without a session.
- `_guest` runs `redirectIfSignedIn`, so a signed-in user who opens `/login` lands on `/chat`.
- `/verify-email` and `/reset-password` are in the `_public` layout, which has no guard: the links in the emails must work whether or not the person happens to be signed in. The layout exists so that the page frame (`Page`, the `<main>`) is written once; the two pages render only their content.
- Both pages read the token from `location.hash` with `useFragmentToken`: it reads the token once into component state and then replaces the history entry with the same URL without the fragment, so the token is not left in the address bar or the browser history. The token lives on in state, which is what lets the reset form resend after a refused password (the server checks the password before it uses up the link). A reload therefore loses the token: the person opens the mailed link again.
- `/verify-email` posts the token as soon as it opens (a `POST`, never a `GET`), once: a ref guards the effect because StrictMode runs effects twice in development and a link works only once (the app-level test runs it in StrictMode). A successful verification or reset calls `recheckSession`, which resets the cached `me`: the link can belong to another account than the one signed in, and a reset deletes every session of the account, so the cache cannot patch itself.
- After signing in, the login page goes to the `redirect` parameter, but only through `safeRedirectPath`: it must start with a single `/`. Anything else (`https://...`, `//host`, `/\host`) falls back to `/chat`, so a crafted login link cannot send people to another site.
- A guard only runs on navigation. When the session ends while a page is open (a request answers 401 and `me` then comes back empty), the `_app` layout (`useRedirectWhenSignedOut`) notices that the cached user became `null` and navigates to `/login?redirect=...`. Signing out on purpose goes to plain `/login`: `useSignOut` says which of the two it is (`isSigningOut`, from the sign-out request's own state: true while it runs and once it has succeeded, false again if it fails). The layout reads the current location once, inside the effect: a hook that follows the location would run the effect again for the `/login` URL it has just navigated to and nest the `redirect` parameter without end (the app-level test caught exactly this).
- Signing in or out replaces the whole cache except `me` (`setSignedInUser`), so the next person at this tab never sees the previous user's rooms or messages.

## Using the API from the screens

The API itself (every endpoint's request, response, status codes, error texts, rate limits, and the rules that come with them) is specified in `./api.doc.md`; the shapes of its bodies are in `server/src/contract/` (see "Shapes" in that document). What follows is only how the screens are meant to use it.

### Account

- Signup form: hint the rules from `./api.doc.md` (name, password, phone number), but show the server's `error` text rather than rebuilding it: client-side checks only save a round trip. A new account has no avatar, so the avatar field belongs to the profile screen, not to signup.
- The "verify your email" banner reads `emailVerified` and offers the resend button; nothing else in the app is blocked for an unverified user. `me` is cached for 5 minutes, so an address verified in another tab or on a phone still shows the banner until then; the resend button's `409 Email is already verified` makes the app fetch `me` again, and the banner goes away.
- The page behind a mailed link reads the token from `location.hash`, posts it, and removes it from the address bar. The reset form words its confirmation like the server does ("if an account exists..."), never "a reset mail is on its way".
- There is no avatar upload, so show initials or a placeholder when `avatarUrl` is `null`. An avatar is a pasted `http:` or `https:` URL, and the server refuses anything else on every endpoint that takes one.

### Rooms and members

- Start a direct chat from the friends list with `POST /api/chat` and use the returned `id`, whether it answered `200` or `201`. Two people who are no longer friends get a `403` there, but their old room keeps working from the room list.
- `POST /api/chat` and `PATCH /api/chat/:chatid` answer with the room as `GET /api/chat/:chatid` shows it (the summary and the person's `role`; `POST` adds `members`), so a direct room's `name` and `avatarUrl` are already the other member's and a reused room has its real `lastMessage` and `unreadCount`: merge it into the cached room list (`addRoomToCache` does it for `POST`) or invalidate `GET /api/chat`.
- Show room actions according to the permission table in `./api.doc.md`, and rely on the server's answers for the rest. A group's only admin cannot leave while others remain (`409`): offer to promote someone first.

### Messages

- `GET /api/chat/:chatid/message` is newest first: reverse it for display, and page back with `before` set to the oldest id loaded.
- To catch up, page forward with `after` set to the newest id loaded: the oldest messages above it, still listed newest first, `hasMore` meaning that newer ones remain (`getMessages(chatId, { after })`). It is for a hole between what is loaded and what is new, not for polling: it does not return the edits and deletes of messages already held.
- Show a placeholder such as "message deleted" for a deleted message, an "edited" label for `editedAt`, and a placeholder name with no actions when `sender` is `null`.
- Mark a room as read with the id of the newest message loaded, then set that room's `unreadCount` to 0 in the cache.
- `lastMessage` has the `id` and the `senderId` of the message. After an edit or a delete, the cache tells from the id whether the message was the room's preview, and when it was, works the new preview out from the messages it holds (`refreshPreviewAfterChange`): the edited message with its new text, or the newest message that is not deleted; the room is placed in the list again. Only when the loaded messages cannot say (they are not loaded, or the newest ones are all deleted with older ones behind them) does it ask for `GET /api/chat` again. The room list shows "You: " before a preview that the signed-in user wrote (`senderId`).

### Friends

- Strip spaces, dashes and parentheses from the typed phone number before `GET /api/friend/search/:tel`, and encode the segment with `encodeURIComponent`: the server accepts only the canonical form.
- `relationship` decides the button: `none` shows "Add friend", `request_sent` shows "Cancel" (`requestId`), `request_received` shows "Accept" (`requestId`), `friend` shows "Message", `self` shows nothing.
- `/api/friend/requests/:id...` takes a request id, `DELETE /api/friend/:id` a user id.
- After an action the cache changes from the server's answer, the cached searches included (`setRelationshipInSearches`): a search is limited to 30 per 15 minutes per user and every request counts, so nothing asks for one on its own (no retry of a failure, no refetch when the tab comes back), and only pressing Search sends one. The lists are the opposite: they are asked for again each time the page opens or the tab comes back to the front, because nothing pushes a new request before step 6.
- A `404` or a `409` from an action (accept, reject, cancel, send, unfriend) means the screen was out of date, so every friend query is invalidated and the server's text is shown where the thing is still on screen. A row that the refreshed list no longer has takes its own text with it, so the three lists also pass the text, with the person's name in front ("Carl: Friend request not found"), to a line of news at the top of the page (`role="status"`, with a Dismiss button); that also covers `409 This user has already sent you a friend request`, after which the refreshed search card offers "Accept" and keeps the text.
- Unfriending changes nothing in the room list: the direct room stays and works (see "Friendship requirement" in `./api.doc.md`).

### Forms that hit a rate limit

- Disable the submit button while a request is running: the limiters count every request, including the ones that fail validation, so a double click spends the budget.

## Implementation steps

### Step 1 — scaffold (done)

The project, the dev proxy, the `api` wrapper, the query client, the `me` guards and the layouts, with a deliberately thin login page and a placeholder `/chat` page with a sign-out button, so the whole loop (guard, cookie, cache, sign-out) could be tried end to end. How these work is in "How the frontend talks to the server", "Foundation: server state and UI state" and "Routing and authentication"; what tests them is in "Testing". What each later step added is in its own section below, and when, in the git history.

### Step 2 — account screens (done)

- Sign-up form (hints, server errors, then a "check your email" notice; signup does not sign in), forgot-password form, `/verify-email` and `/reset-password` pages as described above.
- A "verify your email" banner in the `_app` header when `emailVerified` is `false`, with a resend button (`POST /api/account/email/verification`; show the `409` and `429` messages).
- Replace the thin login page: links to the other forms, and the verification notice.

Built as described. Where the plan was open: the "verification notice" is the sign-up screen's "check your email" notice (it says that signing in does not wait for verification and that the banner resends the mail) plus a note on the forgot-password confirmation (an unverified address gets a verification mail instead of a reset mail). The forgot-password confirmation says "if an account exists", like the server, and never "a mail was sent". The server stores and matches an email address without regard to case (it lower-cases it), so the forms say nothing about case and the client never changes the address.

### Step 3 — chat core (done)

- Room list in a sidebar from `GET /api/chat` (`lastMessage`, `unreadCount`), the open conversation at `/chat/$chatId`. The sidebar belongs in `_app/chat.tsx` (already there as an empty layout), the parent of both chat pages, so it stays mounted while the person goes from one room to another; the two pages render only the conversation.
- Messages with `useInfiniteQuery`: pages arrive newest first, `getNextPageParam` is the oldest id when `hasMore`, and the list is reversed for display. Keep the scroll position when older messages are prepended (the fiddly part: budget time for it).
- Send, edit and delete (sender only). On success, put the message the API returned into the cache; no refetch.
- Mark as read: `PUT /api/chat/:chatid/read` while a room is open and its latest message is in view; update `unreadCount` in the room list's cache.
- Until step 6, give the messages query a `refetchInterval` so the screen feels alive. Step 6 removes it.
- Stop here for a day and use it: this is where the API's shapes get tested for real.

Built as described, with these changes and choices where the plan was open or turned out wrong:

- **Polling asks for the newest page only,** not the messages query with a `refetchInterval` as planned above. An infinite query refetches every page it holds (one request each) and works out each page's cursor from the page before it, so one new message slides the whole loaded window by one and the oldest message on screen disappears from above the person's eyes (seen in a real browser, and it is the reason `useMessages` has no interval). `useNewestMessagesPolling` in `queries.ts` asks for the newest page every 5 seconds and merges it into the loaded pages with `mergeNewestPageIntoCache`: what is new is added, what is loaded is replaced (an edit or a delete from another device shows), and a page that does not reach back to the newest message loaded (a tab that slept, more than a page of messages at once) is a gap, which is closed by paging forward from the newest message loaded with the API's `after` cursor (`catchUp` in `queries.ts`; the socket reconnect of step 6 needs the same thing). Only a conversation with nothing loaded to start from is loaded again. The room list has the plain `refetchInterval`, being one request. Step 6 removes both. An edit or a delete of an old message on another device is not seen until then.
- **The title and picture of the open room come from the room list's entry** (the sidebar loads `GET /api/chat` anyway), so there is no `GET /api/chat/:chatid` query yet; a deep link shows "Chat" until the list has arrived. A `404` from the messages (a made-up room, or one the person is not in) and a path that is not a room id both show "Chat not found".
- **The private room has no name from the server.** Its `type` is `"private"` and its `name` and `avatarUrl` are `null` (see "Private chat room" in `backend.doc.md`), so `roomTitle` gives it the title "My Documents" itself, in the list and above the conversation. The client tells the room by its `type`, never by a name: a group can be called "My Documents" too.
- **Scrolling** (`useMessageScroll`): a conversation opens at the bottom and stays there while messages arrive, always for the person's own message and otherwise only if they were already at the bottom, so reading older messages is never interrupted. Older messages are loaded by the "Load earlier messages" button or by scrolling near the top; the hook notes the scroll position when the request starts and, when the messages arrive, moves down by the height they added. The geometry is checked in a real browser (see "Testing").
- **The read marker** (`useMarkRoomRead`) is sent for the newest loaded message when the room has unread messages, the list is scrolled to the bottom and the tab is in front (`useDocumentVisible`), once for each message. A failed request is not shown: nobody asked for it, and the next change tries again.
- **Editing and deleting** are on the person's own messages only. Delete asks first ("Delete this message for everyone?") because it cannot be undone; the answer is `204` with no message, so the cache makes the deleted message itself (no content, `deletedAt` set), which the next poll replaces with the server's. Enter sends, Shift+Enter starts a new line, and Enter during input-method composition (Telex, VNI) does not send.
- **Phone width:** the room list is the whole screen at `/chat` and the conversation is the whole screen at `/chat/$chatId`, with a "Chats" link back (`md:` and up shows both). The rest of the phone layout is step 7.

### Step 4 — friends (done)

- Search by phone number (`GET /api/friend/search/:tel`), send a request, the lists of incoming and outgoing requests, accept, reject, cancel, the friend list, unfriend, and "message" from a friend (creates or reuses the direct room).

Built as described, with these choices where the plan was open:

- **One page, `/friends`, of four cards:** "Add a friend" (the search and its result), "Friend requests" (incoming: Accept, Reject), "Requests you sent" (Cancel) and "Your friends" (Message, Unfriend). The result of a search is one person with the button of their `relationship`: "Add friend", "Request sent" with "Cancel", "Accept", "Message", and for the person themselves only the words "This is you". A search that finds no one says so; the server's text is shown for a number it refuses and for the limit.
- **A main navigation in the header** (Chats, Friends; the router marks the open page with `aria-current`). On a phone it takes a row of its own under the logo, so the header does not overflow. The step had no way to reach `/friends` otherwise.
- **The typed number is cleaned (`normalizeTel`: spaces, dashes and brackets go) and the segment encoded;** everything else that is wrong is left for the server's `400`. A number without a country code (`0912...`) is refused by the server, and the hint under the field says to start with `+`.
- **Search is disabled while it runs and when there is nothing to search for,** and pressing it again for the same number asks again (a person may be waiting for an answer). Enter does the same as the button, because a form is not submitted by Enter while its button is disabled.
- **Unfriending asks first,** in the row, like deleting a message ("Remove Bea from your friends? Your chats with them stay.").
- **"Message" makes or finds the direct room and opens it.** `useStartDirectChat` (in `features/chats/`) puts the answer into the room list's cache (`addRoomToCache`, so a list loaded before shows the room without a request), and `useMessageFriend` navigates to the room's id whether the server answered `201` or `200`. A `403` (the two are not friends any more) is shown in the row, and the person stays on the page.
- **Row actions have the person's name in their accessible name** ("Accept Bea", "Message Bea"), so a screen reader hears which of several identical buttons it is on; the visible text starts the name.
- **A row that goes because the page was out of date is explained in a line at the top of the page** (a request the other person took back or answered, a friend who unfriended elsewhere). The row's own error would go with it when the refreshed list drops the row, so `useAcceptFriendRequest`, `useDeleteFriendRequest` and `useUnfriend` take an optional `onOutOfDate` callback for the `404` or `409` text, and `FriendsPage` keeps the one line (a newer piece of news replaces it; Dismiss clears it). The callback is given to the hook and not to `mutate`: a callback of `mutate` does not run once the row that called it is unmounted. The search card keeps its error where it is and passes nothing, because the card does not go. The `role="status"` region is always in the page, empty (`empty:hidden`), because a screen reader only announces text put into a live region that was already there.
- **A person can be in the search card and a list at once,** and what one does changes the other through the cache (`setRelationshipInSearches`): accepting from the list turns the card into "Message", cancelling from the card removes the row.
- **No polling and no badge:** see "Open questions". The lists are asked for again when the page opens and when the tab comes back to the front.

### Step 5 — account settings and room management

- `/settings`: change name and avatar URL (`PATCH /api/account/me`), change password (`POST /api/account/password`), delete account (`DELETE /api/account/me`; show the rooms from the `409`'s `chatIds`).
- Create a group room, the member list, add and remove members, promote and demote, leave, rename. Show actions according to the permission table in `./api.doc.md`, and rely on the server's answers for the rest.

### Step 6 — Socket.io, together with the server

Server and client are written in the same step, so each event can be tried as soon as it exists. The events are specified in `./api.doc.md` ("Real-time events") and the server side is described in `./backend.doc.md`: the socket is a notification layer on top of REST and never a second way to write data.

Client side:

- One socket for the signed-in session, created in the `_app` layout and closed on sign-out. It connects through the same origin (add `'/socket.io': { target, ws: true }` to the dev proxy), so the handshake carries the session cookie. `lib/socket.ts` makes the connection; each feature exports the function that applies its events to the cache (the same functions the mutations call), and the `_app` layout attaches them.
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
| `friend:request`, `friend:accepted` | invalidate the friend list and the two request lists (`friendKeys.list()`, `friendKeys.requests(...)`), not the searches: `friendKeys.all()` would also search again, which spends the search limit |

- On every reconnect, invalidate the active queries: events sent while the socket was down are gone.
- Typing indicators are socket-only: held in UI state with a timeout, never cached or stored.

### Step 7 — design, polish, deployment

- Polish of the chat and friends screens (the account screens are styled, see "Styling"), empty and error states, keyboard use, phone layout of the chat screens (the account screens already work at phone width).
- Production setup as described in "How the frontend talks to the server".

## Testing

- `npm test` runs Vitest on `test/**/*.test.ts(x)`. No database and no server are needed. A test file put anywhere else is not run, because `vitest.config.ts` only looks in `test/`; `test/structure.test.ts` fails when one is left in `src/`, and also when `lib/` or `components/` import from `features/` or `routes/`, or anything in `src/` imports from `test/`. `tsconfig.json` includes `test/`, so `npm run typecheck` checks the tests too.
- Unit tests cover the logic that can be wrong without anything looking wrong: the fetch wrapper (the request it really builds, `204`, error bodies, a lost connection, cancellation), the query client's retry and 401 rules, the guards and `safeRedirectPath`. They run the real code against a stubbed `fetch`.
- `test/app.test.tsx` runs the real router, guards, query client and screens in jsdom against a fake API, for the loops no unit test sees: signed-out visitor to login and back to the page they wanted, wrong credentials, off-site `redirect` ignored, sign-out clearing the cache, a session ending while a page is open, a sign-out that fails (a session that ends afterwards is still not a sign-out), and a 401 that must not sign anyone out. Each new screen with a flow of that kind gets a test in a file like this one: `test/accountScreens.test.tsx` has signup, forgot and reset password, the mailed-link pages (token posted once in StrictMode, token removed from the URL) and the banner. The fake API (`test/helpers/fakeApi/`) follows `./api.doc.md`; when an endpoint's shape changes there, change the fake in the same patch. It has one file per feature (`account.ts`, `chats.ts`, `friends.ts`), each a function that answers its own endpoints and returns `undefined` for any other request, and one shared state (`state.ts`). Faking a new feature's endpoints means a new file, one more entry in the list in `index.ts`, and its data in the state.
- The aim is not full coverage: tests are for behaviour that matters and is easy to break. When a test is written for a new rule, break the code on purpose once and check that the test fails.
- `test/app.test.tsx` also checks that `/chat` is matched inside the `_app/chat.tsx` layout.
- `test/chatScreens.test.tsx` runs the chat screens against the fake chat endpoints: the list (order, preview, unread count, the same sidebar element across rooms), a conversation (order, who may act, a group's sender names, deleted and edited messages, a room that is not there), sending (from the answer, no refetch of the messages, Enter and Shift+Enter, a refusal keeps the text), editing and deleting (the room preview follows from the loaded messages without a request, and the room list is asked for only when they cannot say), the "You:" prefix, older messages (the cursor, the order, a failure), the read marker (once, only when something is unread, only at the bottom and in front) and the polling (the newest page only, with fake timers). A mutation check on 2026-10-25 (ten changes to the cache, the cursor, the marker and the scroll code) was caught by a test each. The fake chat endpoints follow `./api.doc.md` with the room's unread count and last message worked out from its messages, as the server does.
- `test/friendsScreens.test.tsx` runs the friends page against the fake friend endpoints: the lists (the friends in name order, the newest request first, empty states, a list that fails with a retry), the search (the number cleaned and encoded, "Add friend" and "Request sent", no one found, the server's texts for a refused number and the limit, Search disabled when empty and while it runs, the same number searched again, the button for each relationship, no button for oneself, a screen that was out of date), accepting, rejecting and cancelling from the lists and from the card (what the other one then shows, and that no list is asked for again), unfriending after a question, "Message" (a new room, the room that exists, from the card, into a room list loaded before, a `403`), the page's line of news (for a request taken back, one answered, a friend who is not one any more, in a live region, dismissed or replaced, and not there when an action works or the card keeps the text), the main navigation, and that a signed-out visitor is sent to the login page. A mutation check on 2026-11-04 (27 changes to the cache, the hooks, the search rules and the components) was caught by a test each; one survived, a second empty-number guard behind the disabled button, which was removed. The same check on 2026-11-06 for the line of news (nine changes: the hook, each of the four callers, the name, the live region, Dismiss) was caught by a test each. The fake friend endpoints follow `./api.doc.md`, and `POST /api/chat` of the fake chat endpoints makes only direct rooms, after the friend check.
- The friend functions of `features/friends/api.ts` and `createDirectChatRoom` were run against the real server on 2026-11-04, with two accounts (search with a typed number, no one found, a refused number, send, both lists, the `409` texts and the `requestId` of the crossed request, accept, reject and cancel, unfriend, the direct room made and found again, the `403` once unfriended, the old room still listed): every shape, status code and text was the one `./api.doc.md` says and the fake API has.
- jsdom has no layout, so the scroll tests give the message list one (`stubScrollLayout`: 50px a message in a window of 400px, a settable `scrollTop`) and check the arithmetic: the bottom on opening, the position kept when older messages are added, new messages followed only from the bottom, a sent message always scrolled to. How a real browser lays it out was looked at in headless Chromium on 2026-10-25 (the setup is in `CLAUDE_SANDBOX_NOTES.md`): the list opens at the bottom, the same message stays under the same pixel after older ones are added (exactly the added height), a new message while reading higher up moves nothing, a sent message scrolls to the bottom, and the phone width has no horizontal overflow. The friends page and the new header were looked at there on 2026-11-04 (390px and 1100px wide, light and dark, a long name, a search result): no horizontal overflow, the navigation on a row of its own on a phone, the name truncated before the buttons.
- `test/pageFrame.test.tsx` visits every page and checks that it has exactly one `<main>`, the one `Page` draws: a page that writes its own again, or a layout that forgets the frame, fails it.
- Tests find things by role and label, never by class, so a restyle changes no test (the styling of 2026-10-24 changed none). Not tested: how it looks.
- A runaway navigation loop shows up in the app test as a worker that dies after about half a minute ("JavaScript heap out of memory"), with `Not implemented: Window's scrollTo()` repeated before it.

## Structure review

A review of how `frontend/` is organised, done at the end of step 2 (2026-10-18). It found eight things and two smaller ones; all of them are done. The rules that came out of it are in "Conventions", the new layout is in "Project structure", and this section keeps what was found and why, so the reasons are not lost.

Sound from the start, and kept: the direction of the imports (`routes/` use `features/`, `features/` use `lib/` and `components/`, and `lib/` imports nothing from the features), `api.ts` as the only file that knows a URL path, one hook layer (`queries.ts`) between the components and the network, and `createApp` as the one place where the app is wired. Left alone on purpose: the wiring files (`main.tsx`, `App.tsx`, `createApp.ts`, `router.tsx`) next to `routeTree.gen.ts` at the root of `src/` (a folder for them pays off only when there are more of them), and the single `styles.css` (that is the styling question under "Open questions").

### Found and done

- **Tests next to the code.** They made a folder listing of `src/` half test files. They are now in `test/`, mirroring `src/`, with `test/helpers/` for what they share, like the server (see "Decisions").
- **`features/chats/` and `features/messages/` were planned as two folders, but are one feature.** The plan already treated them as one (one `chatKeys` factory; `message:new` updates the room list's cache; `chat:removed` drops the messages) and the server has one `chatrooms` module; two folders would import each other. "Planned additions" now has one `features/chats/`.
- **`/chat` and `/chat/$chatId` had no shared layout.** The room-list sidebar of step 3 would have been rendered by each page and remounted on every room switch. `_app/chat.tsx` exists now (an empty layout until step 3), with a test that `/chat` is matched inside it.
- **`routes/_app.tsx` was not thin.** The header, the sign-out button and the session-ended redirect were in the route file. `AppLayout` and `useRedirectWhenSignedOut` are now in `features/account/`, and the route file keeps the guard.
- **The page frame was written four times.** There is one `Page` component (`components/ui/`) now, a `_public` layout for `/verify-email` and `/reset-password` (same URLs), and `ResetPasswordForm`, which rendered a whole page, is `ResetPasswordPage`. `test/pageFrame.test.tsx` checks that every page has exactly one `<main>`.
- **The provider tree was written twice, in `main.tsx` and in `renderApp`.** A provider added to `main.tsx` would have been missing from every app-level test. Both render `App` now.
- **Long relative imports.** An `@/` alias for `src/` is used for every import that leaves a feature or a folder (see "Decisions").
- **`fakeApi.ts` was one `switch` over every endpoint.** It is `test/helpers/fakeApi/` now, one file per feature over one shared state, so faking the chat endpoints is a new file and not a longer switch.
- **Nothing said when a component leaves its feature.** The rule is in "Conventions": it starts in its feature and moves to `components/ui/` when a second feature needs it.

### Smaller things

- `useRedirectWhenSignedOut` took a mutable ref from the sign-out button, which tied the hook to the button's insides. `useSignOut` (in `queries.ts`) now gives `isSigningOut` from the sign-out request's own state, nothing is reset by hand when it fails, and the redirect hook takes the value. A test that a session ending after a failed sign-out is still not taken for one covers it.
- Two comments said the 401 recheck is in `main.tsx`; it is in `createApp.ts`. Fixed.
- A test file left in `src/` was silently not run, because `vitest.config.ts` only looks in `test/`. `test/structure.test.ts` fails on it now, and it also checks the import rules of "Conventions" for `lib/`, `components/` and `test/`.

## Decisions

- **Dev proxy instead of CORS.** One origin in development, the same shape as production. CORS stays a later option.
- **`/api` prefix** on every API path, on the server as well as in the browser: the proxy forwards requests unchanged, so an endpoint has one path everywhere (it used to be stripped by the proxy).
- **`strictPort` on 5173**, because the mails link there.
- **`me` returns `user: null`** and is the single source of "who is signed in", cached for 5 minutes and rechecked on any 401.
- **No blanket sign-out on 401** (see "How the frontend talks to the server").
- **`_guest` layout, but `/verify-email` and `/reset-password` in a layout of their own (`_public`) without a guard,** because the email links must work in both states. The layout also draws the page frame, so no page writes its own `<main>`.
- **Redirect after login** through `safeRedirectPath`; plain `/login` after a deliberate sign-out.
- **TanStack Router file-based routing, `routeTree.gen.ts` committed.**
- **Tests in `frontend/test/`, mirroring `src/`,** the way the server keeps its tests in `server/test/` (with `helpers/` for what they share), so `src/` holds only what ships to the browser and a folder listing of the app is not half test files. The price is that a test file left in `src/` would not be run, which `test/structure.test.ts` turns into a failure.
- **One `features/chats/` for rooms, members and messages,** not a folder each. See "Planned additions" for why.
- **An `@/` alias for `src/`,** so an import from another folder does not count `../` (`../../../src/features/account/types` became `@/features/account/types`) and moving a file does not break the imports that leave its folder. It is one `paths` entry in `tsconfig.json` plus `resolve.tsconfigPaths: true` in the Vite and Vitest configs (a Vite 8 option, so no plugin). Imports inside a feature stay relative on purpose.
- **Vitest 5** in the frontend (the server uses Vitest 4): Vitest 5 installed cleanly next to Vite 8, while installing Vitest 4 there failed with an npm error in the sandbox this was built in. Align the two later if it matters.
- **The API's shapes are code in one folder, `server/src/contract/`,** that the server and the frontend both compile against, rather than a copy in each feature's `types.ts` (with the one in `api.doc.md` and the fake API's, a third and fourth copy that no compiler compares). The folder is inside the server's `src/` because the server's `tsc` runs with `rootDir: ./src`: a `shared/` folder at the repository root would need the server's build changed, and an npm workspace would merge two lockfiles. Zod schemas and an OpenAPI generator were left out: the validators' rule order and error texts are part of the API, and both would mean rewriting them. The price is that the frontend's type check reads files under `server/`, which `test/structure.test.ts` limits to this folder and to `import type`.
- **The API specification has its own document**, `./api.doc.md`, that this document and `./backend.doc.md` both point to, so an endpoint change is made in one place. The backend doc keeps how the endpoints are built.
- **Plain CSS in steps 1 and 2, then Tailwind CSS v4** (2026-10-24, before step 3 grows the CSS). The reasons and the rules are in "Styling".
- **`src/styles/` instead of one `styles.css`** (2026-10-25). Tokens and base rules change for different reasons (a new color, a rule for a bare element), and a folder with an entry file has a place for the next concern that is not "the end of the one file". Component styles stay in the components, so there is no per-component CSS to organise. The compiled CSS was compared byte for byte before and after the split.
- **The mailed-link pages read the token once into state and strip the fragment** (see "Routing and authentication"), and `recheckSession` resets `me` after a verification or a reset instead of patching the cached user.
- **The conversation polls the newest page and merges it, not the whole query** (2026-10-25, step 3). See "Step 3" under "Implementation steps" for why.
- **`AppLayout` is exactly `h-dvh`, and `Page` has a `layout` prop** (`narrow`, `column`, `fill`) instead of `narrow` (2026-10-25, step 3): a chat screen needs a shell that is as high as the window with parts that scroll by themselves, and two booleans (`narrow`, `fill`) would have allowed a combination that means nothing.
- **The friend lists are asked for again on every visit and refocus (`staleTime: 0`), a search never is** (2026-11-04, step 4). A request can arrive while nobody looks and nothing pushes it before step 6, while a search is limited and counts every request. See "Using the API from the screens".
- **The cache is patched from each friend action's answer, searches included,** instead of invalidating after it (step 4): invalidating would search again (the limit) and ask for three lists for one click. A `404` or `409` is the exception and invalidates everything, because it says the screen is out of date.
- **"Message" is in `features/chats/` as `useStartDirectChat`,** with `useMessageFriend` in `features/friends/` to navigate: the room list's cache belongs to the chats feature, and the friends feature only imports its hook.
- **One `ListState` for every list that loads** (2026-11-06): the friends page's three lists had it, and `RoomList` had the same loading, error-and-retry and empty states written out inline, so by the rule in "Conventions" it moved to `components/ui/` when the second feature needed it. One difference for the room list: it used to show an error above the rooms it had when a refetch failed, and it polls every 5 seconds, so a dropped request flashed a message over a list that was fine; now the rooms stay and nothing is said, like the friends lists.
- **Signup shows a notice, not a sign-in.** The server does not sign anyone in at signup; the notice does not promise the mail (a mail that cannot be sent does not fail the request) and points to the banner's resend button.

## Open questions

- ESLint and Prettier: neither the server nor the frontend has them yet. Tailwind gives two more reasons: `prettier-plugin-tailwindcss` puts the classes of every `className` in one fixed order (they are written by hand now), and a Tailwind-aware lint rule, such as the one in `eslint-plugin-better-tailwindcss` (check its rule list), can report a class that does not exist, which Tailwind itself silently ignores.
- Optimistic updates for sending a message (show it at once, mark it failed if the request fails): worth it after step 3 has been used for a while.
- A draft is lost when the person goes to another room (the conversation is remounted for each room), as is an edit in progress.
- A failed read marker is silent, and the unread badge of the open room stays until the request has answered.
- The message list is not virtualised and loads pages only as the person scrolls up; the "Load earlier messages" button is the fallback for a window taller than a page.
- Long conversations: virtualized message list if scrolling gets slow.
- Pagination for `GET /api/chat` and `GET /api/friend` once the lists can grow (the server notes this already).
- A request that comes in is only seen when the friends page is opened or the tab comes back to the front. A count on the "Friends" link waits for step 6's `friend:request`: polling for it on every page would be a request every few seconds for one number.
- A friend who was unfriended on another device stays in the list until it is asked for again; "Message" on them shows the server's `403` text and does not ask again.
- Browser notifications and an unread count in the tab title.
