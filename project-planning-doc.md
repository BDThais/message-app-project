# Message App Project Planning & Progress

## Overview

This project is a real-time messaging application built with PostgreSQL, Prisma, TypeScript, Express.js, and a React frontend.
The backend has grown beyond the original account/session MVP and now includes a working chat-room foundation with direct and group room support, while the remaining friend and realtime features are still planned work.

## Tech Stack

- PostgreSQL
- Prisma ORM
- TypeScript
- Express.js
- React
- TanStack Query
- Socket.io
- TanStack Router
- Argon2 (password hashing), cookie-parser, express-rate-limit
- Vitest + Supertest (tests), Docker Compose (test database)

## Test database setup

Backend tests are integration tests (Vitest + Supertest) that run against a separate PostgreSQL database provided by
`server/docker-compose.test.yml` (`chatapp_test`, port 55432). Copy `server/.env.test.example` to
`server/.env.test` once, then run `npm test` from `server/`. The test command
starts the container, deploys the existing Prisma migrations, and runs Vitest.
`test/setup.ts` refuses to run unless `NODE_ENV=test` and the database is `chatapp_test`, and it empties every table
before each test. It does not use the development database configured in `server/.env`.

Scripts (run from `server/`):

- `npm test`: start the test database, apply migrations, run every test file (one at a time)
- `npm run db:test:up` / `npm run db:test:down`: start or stop the test database container
- `npm run db:test:deploy`: apply the Prisma migrations to the test database
- `npm run db:test:reset`: reset the test database and re-apply all migrations
- `npm run test:unit`: run only the database-free tests (files named `*.unit.test.ts`, see `vitest.unit.config.ts`); no database needed

Name any new database-free test `*.unit.test.ts` so `test:unit` picks it up. Every other test file is an integration
test and needs the test database.

## Current Implementation Status

The backend is now at a broader API MVP than the original plan. The active implementation includes the account lifecycle and the room-management layer required for chat features:

Completed:

- POST /account/signup
- POST /account/login
- GET /account/me
- POST /account/logout
- POST /chatrooms
- GET /chatrooms
- GET /chatrooms/:chatid
- PATCH /chatrooms/:chatid
- DELETE /chatrooms/:chatid
- POST /chatrooms/:chatid/members
- DELETE /chatrooms/:chatid/members/:userid
- PATCH /chatrooms/:chatid/members/:userid
- POST /chatrooms/:chatid/messages
- GET /chatrooms/:chatid/messages
- Chat membership validation and admin/role enforcement
- Direct-room reuse and group-room creation flows
- Basic room summaries with latest-message metadata
- Automatic cleanup of chat rooms that stay empty (see "Empty chat room cleanup")
- Integration tests for the account endpoints, the chat-room endpoints and the empty-room cleanup

Still planned or not yet implemented:

- Message editing and deletion APIs for chat rooms
- Friend search and friend request flows
- Friendship management and acceptance/rejection
- Real-time socket communication
- Frontend application screens and state management
- Production deployment hardening

The room and auth systems are now acting as the current working backend foundation. Friend and realtime features remain future work and should be treated as the next milestone rather than as missing pieces of the current baseline.

Note: In the database, the mutual friendship model stores two rows per friendship pair, one for each user, as described in the project requirements.

## Permission model

| Action                  | admin | member |
| ----------------------- | :---: | :----: |
| Send / read messages    |  ✅   |   ✅   |
| Update room name/avatar |  ✅   |   ❌   |
| Delete room             |  ✅   |   ❌   |
| Add members             |  ✅   |   ❌   |
| Remove other members    |  ✅   |   ❌   |
| Leave the room          |  ✅   |   ✅   |
| Promote/demote a member |  ✅   |   ❌   |

Implemented so far: update, delete, add members, remove members, leave, promote/demote, sending messages and reading messages.

## API Status

### Auth endpoints (implemented)

POST /account/signup

- Creates a new user account
- Validates name, email, tel, and password
- Checks for duplicate email or phone number
- Hashes the password before saving
- incoming body:

  ```json
  {
    "name": "JohnDoe",
    "email": "john@example.com",
    "tel": "+1234567890",
    "password": "Str0ng!Pass"
  }
  ```

- return body (`201`):

  ```json
  {
    "message": "Account created successfully"
  }
  ```

- responds `400` with `{ "error": ... }` when validation fails and `409` when the email or phone number is already taken

POST /account/login

- Validates the supplied email/password
- Returns a generic invalid credentials message for both failed user and password checks
- Deletes any expired session already stored for the same user
- Creates a new session and sets the session cookie
- Rate limited to 10 attempts per 15 minutes per IP (`429` afterwards)
- responds `400` when email or password is missing or not a string, and `401` for invalid credentials
- incoming body:

  ```json
  {
    "email": "john@example.com",
    "password": "Str0ng!Pass"
  }
  ```

- return body:

  ```json
  {
    "user": {
      "id": 1,
      "name": "JohnDoe",
      "email": "john@example.com",
      "tel": "+1234567890"
    }
  }
  ```

GET /account/me

- Returns the current authenticated user or null if there is no session
- return body:

  ```json
  {
    "user": {
      "id": 1,
      "name": "JohnDoe",
      "email": "john@example.com",
      "tel": "+1234567890"
    }
  }
  ```

  When there is no valid session, `user` is `null`.

POST /account/logout

- Invalidates the current session if it exists
- Clears the session cookie
- Returns the user as null
- return body:

  ```json
  {
    "user": null
  }
  ```

### Implemented room and planned extension endpoints

All of these endpoints are routed after auth middleware so they can access the current user's data through `req.user`.
`req.user` shape = {
  id: number;
  name: string;
  email: string;
  tel: string;
}
A direct room has no name/avatar to edit, its members cannot add or remove the other member from the room, and all of its members are admins.
Endpoints that require authorization have to be routed after the auth middlewares.

POST /chatrooms (implemented)

- create a new chat room
- incoming body: type, member_ids, name?, avatar_url?
- for direct rooms, `member_ids` must contain exactly one other integer user ID; direct rooms cannot include `name` or `avatar_url`
- for group rooms, `member_ids` may be omitted or be an empty array; the requester is always added as an admin
- group rooms may include `name` and `avatar_url`
- incoming body:

  ```json
  {
    "type": "group",
    "member_ids": [],
    "name": "Project chat",
    "avatar_url": "https://example.com/project-chat.png"
  }
  ```

- a group room can also be created without `member_ids` or with additional member IDs, for example `"member_ids": [2, 3]`
- responds `201` when a new room is created and `200` when an existing direct room between the same two users is reused
- responds `400` on validation errors or when a `member_ids` entry does not refer to an existing user
- return body:

  ```json
  {
    "id": 1,
    "type": "group",
    "name": "Project chat",
    "avatarUrl": "https://example.com/project-chat.png",
    "createdAt": "2026-09-13T12:00:00.000Z",
    "members": [
      {
        "memberId": 1,
        "chatId": 1,
        "role": "admin",
        "lastReadMessageId": null,
        "member": {
          "id": 1,
          "name": "JohnDoe",
          "avatarUrl": null
        }
      },
      {
        "memberId": 2,
        "chatId": 1,
        "role": "member",
        "lastReadMessageId": null,
        "member": {
          "id": 2,
          "name": "JaneDoe",
          "avatarUrl": null
        }
      }
    ]
  }
  ```

GET /chatrooms (implemented)

- retrieve a list of all the chat rooms that have this user as its member
- have separate functions for retrieving direct and group chat room, the functions return all direct/group chat rooms that has req.user
  as member (with datas of the last message in that room like it's content, time created) when it's not supplied with a specific chatid.
  The function responsible for retrieving direct chat room return the other user'name as the room's name and use their avatar url (if it's not null)
  as the room's avatar url
- the success response return the chat rooms sorted by how recent is the last message, the rooms that doesn't have last message is sorted by time created
- return body:

  ```json
  {
    "chatRooms": [
      {
        "id": 1,
        "type": "group",
        "name": "Project chat",
        "avatarUrl": "https://example.com/project-chat.png",
        "createdAt": "2026-09-13T12:00:00.000Z",
        "lastMessage": {
          "content": "Hello",
          "createdAt": "2026-09-13T12:05:00.000Z"
        }
      }
    ]
  }
  ```

GET /chatrooms/:chatid (implemented)

- retrieve data about a specific room
- return body:

  ```json
  {
    "chatRoom": {
      "id": 1,
      "type": "group",
      "name": "Project chat",
      "avatarUrl": "https://example.com/project-chat.png",
      "createdAt": "2026-09-13T12:00:00.000Z",
      "lastMessage": {
        "content": "Hello",
        "createdAt": "2026-09-13T12:05:00.000Z"
      },
      "role": "admin"
    }
  }
  ```

PATCH /chatrooms/:chatid (implemented)

- update the room's name and/or avatar_url
- only valid for type: group rooms
- requires the requester to hold admin in this room
- incoming body: { name?, avatar_url? }
- incoming body:

  ```json
  {
    "name": "Updated project chat",
    "avatar_url": null
  }
  ```

- return body:

  ```json
  {
    "chatRoom": {
      "id": 1,
      "type": "group",
      "name": "Updated project chat",
      "avatarUrl": null,
      "createdAt": "2026-09-13T12:00:00.000Z"
    }
  }
  ```

DELETE /chatrooms/:chatid (implemented)

- delete the room; cascades to its messages and memberships automatically
- only valid for type: group rooms
- requires admin
- no response body (`204 No Content`)

POST /chatrooms/:chatid/members (implemented)

- add one or many existing user to the room
- only valid for type: group rooms
- requires admin
- incoming body: { member_ids }
- new members are inserted with role: member
- `member_ids` is required: a non-empty array of positive integer user IDs (duplicates are ignored)
- users who are already members (including the requester) are skipped and left unchanged, so an existing admin is never demoted; their IDs are returned in `alreadyMemberIds`
- if any ID does not refer to an existing user, respond `400` and add nobody from that request
- responds `201` when at least one member was added, `200` when everyone was already a member
- incoming body:

  ```json
  {
    "member_ids": [2, 3]
  }
  ```

- return body:

  ```json
  {
    "addedMembers": [
      {
        "memberId": 3,
        "chatId": 1,
        "role": "member",
        "lastReadMessageId": null,
        "member": {
          "id": 3,
          "name": "Carol",
          "avatarUrl": null
        }
      }
    ],
    "alreadyMemberIds": [2]
  }
  ```

DELETE /chatrooms/:chatid/members/:userid (implemented)

- remove a member from the room (delete their ChatMember record)
- a user can always remove themself (leave); removing someone else requires admin
- if the chat room is of type "direct", don't let them remove any member other than themself even if they're admin
- reject with 409 if the target is the room's only remaining admin and other members are still present (basically speaking, the group room admin can't remove themself if they're the only admin in the group room). This rule doesn't apply to direct room since direct room only have 2 members and both are admins
- if there are less than 1 member in the room after a removal (usually mean that the last member is an admin and they remove themself), then that mean there are no longer any ChatMember record that linked to this ChatRoom record and the ChatRoom record will be deleted after a set period of time along with it's messages.  
- `:userid` must be a positive integer user ID, otherwise `400`
- responds `204 No Content` (no response body) when the member was removed
- responds `403` when a non-admin tries to remove someone else, or when anyone tries to remove the other member of a direct room
- responds `404` when the target user is not a member of this room (a requester who is not in the room gets the usual `404` from the membership check)
- responds `409` when the target is the room's only admin and other members are still present
- this endpoint never deletes the ChatRoom record itself: when the last member leaves, it stamps the room's `emptied_at` in the same transaction, and the room is deleted later by the cleanup job (see "Empty chat room cleanup")
- the room row is locked (`SELECT ... FOR UPDATE`) while the removal runs, so two admins leaving at the same moment cannot both pass the only-admin check and leave a room with members but no admin

PATCH /chatrooms/:chatid/members/:userid (implemented)

- change a member's role in the given room
- only valid for type: group rooms
- requires admin
- incoming body: { role: 'admin' | 'member' }
- setting a member's role to the one they already hold is allowed and simply confirms it
- reject with 409 if the target is the room's only remaining admin, the new role is 'member', and other members are still present (the same only-admin invariant `DELETE /chatrooms/:chatid/members/:userid` enforces on removal); this rule doesn't apply when the target is the room's only member
- `:userid` must be a positive integer user ID, otherwise `400`
- responds `404` when the target user is not a member of this room
- incoming body:

  ```json
  {
    "role": "admin"
  }
  ```

- return body (`200`):

  ```json
  {
    "member": {
      "memberId": 2,
      "chatId": 1,
      "role": "admin",
      "lastReadMessageId": null,
      "member": {
        "id": 2,
        "name": "Bob",
        "avatarUrl": null
      }
    }
  }
  ```

POST /chatrooms/:chatid/messages (implemented)

- post a new message to the chat room
- both admins and regular members may send, in direct or group rooms alike; membership alone is required (no group-only or admin-only guard on this route)
- incoming body: `{ content }`, a non-empty string (whitespace-only is rejected) trimmed and capped at 4000 characters
- incoming body:

  ```json
  {
    "content": "Hello!"
  }
  ```

- return body (`201`):

  ```json
  {
    "message": {
      "id": 1,
      "chatId": 1,
      "senderId": 1,
      "content": "Hello!",
      "createdAt": "2026-09-25T12:00:00.000Z",
      "sender": {
        "id": 1,
        "name": "JohnDoe",
        "avatarUrl": null
      }
    }
  }
  ```

- responds `400` when `content` is missing, blank, not a string, or over the length limit

GET /chatrooms/:chatid/messages?before=<message_id>&limit=50 (implemented)

- retrieve messages in the room, newest first
- both admins and regular members may read, in direct or group rooms alike; membership alone is required (no group-only or admin-only guard on this route), same as sending
- `before` is optional; when given, only messages with a smaller id are returned, so paging further back means passing the id of the oldest message already loaded. Validated the same way `:chatid`/`:userid` are (positive integer, within the Postgres integer range)
- `limit` is optional, defaults to 50, and is capped at 100
- responds `400` when `before` or `limit` fail validation
- return body (`200`):

  ```json
  {
    "messages": [
      {
        "id": 3,
        "chatId": 1,
        "senderId": 1,
        "content": "Third message",
        "createdAt": "2026-09-25T12:00:02.000Z",
        "sender": {
          "id": 1,
          "name": "JohnDoe",
          "avatarUrl": null
        }
      }
    ],
    "hasMore": true
  }
  ```

- `hasMore` is `true` when older messages remain beyond the returned page

PATCH /chatrooms/:chatid/messages/:message_id

- edit a message's content

DELETE /chatrooms/:chatid/messages/:message_id

- delete a message from the chat room, after the deletion future queries about that message will shown that it's deleted (this might need a db migration to add some kind of "deleted" field to the message model in order to implement this behavior)
- the default behavior is to delete the message for everyone in the room

GET /friend/search/:tel

- search users by phone number

GET /friend

- retrieve the user's friends list

DELETE /friend/:id

- unfriend a user
- remove the mutual friendship records for both users

GET /friend/requests

- retrieve the list of friend requests for the current user

POST /friend/requests

- send a friend request with body: receiver_id
- if the receiver already sent one to you, deny the request and point to the inbox flow instead

POST /friend/requests/:id/accept

- accept the pending friend request for the given user ID
- add the friendship records to both sides
- remove the request record afterwards

DELETE /friend/requests/:id

- reject a pending friend request
- delete the request from the database

## Project Structure

The repository contains a TypeScript/Express server with Prisma persistence, authentication, and the current chat-room backend implementation. The React frontend has not been created yet.
Generated files created by tools such as Prisma (`server/src/generated/`) are omitted from this structure, while the source-controlled Prisma schema remains documented.

The server is organized by feature: each folder under `src/modules/` holds everything for one feature (routes, controller, validators, services, feature-specific middleware and jobs). Only code shared by several features lives in `src/middlewares/` and `src/lib/`.

```text
message-app/
├── .dockerignore
├── .gitignore
├── project-planning-doc.md
├── README.md
├── frontend/                        // planned, not created yet
└── server/
    ├── .env.test.example            // template for .env.test (test database settings)
    ├── docker-compose.test.yml      // throwaway PostgreSQL used by the tests
    ├── package.json
    ├── prisma.config.ts
    ├── tsconfig.json
    ├── vitest.config.ts             // integration tests (uses test/setup.ts)
    ├── vitest.unit.config.ts        // runs only test/**/*.unit.test.ts (no database)
    ├── prisma/
    │   ├── schema.prisma
    │   └── migrations/              // Database migration history
    ├── scripts/
    │   ├── fix-esm-imports.mjs      // after tsc: adds .js to the relative imports in dist/
    │   └── test-db.mjs              // up | down | deploy | reset for the test database
    ├── src/
    │   ├── app.ts
    │   ├── server.ts
    │   ├── config/
    │   │   └── config.ts
    │   ├── lib/
    │   │   ├── constants.ts
    │   │   ├── passwordHash.ts
    │   │   └── prisma.ts
    │   ├── middlewares/             // shared by several features
    │   │   ├── ErrorHandler.ts
    │   │   ├── RateLimiter.ts
    │   │   ├── SessionCookie.ts     // set/clear/read the session cookie
    │   │   └── UserSessionAuth.ts   // requireUserAuth
    │   └── modules/
    │       ├── account/
    │       │   ├── account.routes.ts
    │       │   ├── account.controller.ts
    │       │   ├── account.service.ts
    │       │   ├── session.service.ts   // session database operations
    │       │   ├── login.validator.ts
    │       │   └── signup.validator.ts
    │       └── chatrooms/
    │           ├── chatRoom.routes.ts
    │           ├── chatRoom.controller.ts
    │           ├── chatRoom.validator.ts
    │           ├── chatRoomAuth.middleware.ts   // loadChatMembership, requireGroupRoom, requireChatAdmin
    │           ├── chatRoom.service.ts
    │           ├── chatMember.service.ts
    │           ├── message.service.ts
    │           ├── chatRoomCleanup.service.ts
    │           └── chatRoomCleanup.job.ts
    └── test/
        ├── setup.ts
        ├── helpers/                          // shared fixtures, not test files
        │   ├── users.ts                      // createUser, loginAs (session cookie without going through /account/login)
        │   └── chatRooms.ts                  // createGroupRoom, createDirectRoom, promoteToAdmin, memberIdsOf
        ├── account/
        │   ├── session.test.ts               // login, me, logout
        │   └── signup.test.ts
        └── chatrooms/
            ├── chatRoom.test.ts              // create, list, get, update and delete a room
            ├── chatRoom.permissions.test.ts  // sign-in, membership, group-only and admin-only guards, per route
            ├── chatRoomMembers.add.test.ts
            ├── chatRoomMembers.remove.test.ts
            ├── chatRoomMessages.send.test.ts
            ├── chatRoomMessages.get.test.ts
            ├── chatRoom.validator.unit.test.ts
            ├── chatRoomCleanup.service.test.ts
            └── chatRoomCleanup.job.unit.test.ts
```

Conventions:

- File names follow `<subject>.<role>.ts`, for example `chatRoom.service.ts` or `login.validator.ts`.
- A new feature gets its own folder under `src/modules/` with its routes, controller, validator(s) and service(s); its router is mounted in `app.ts`.
- All database operations are kept in the `*.service.ts` files and go through the shared Prisma client from `src/lib/prisma.ts`. There is no separate repositories layer, so a transaction (room creation, member removal) stays inside one service function.
- A fixed technical limit shared by more than one module (for example the Postgres INTEGER max, reused as both an ID ceiling and a `setInterval`/`setTimeout` delay ceiling) is declared once in `src/lib/constants.ts` and imported everywhere it's needed, instead of being redeclared per file.
- Services never import Express (no `req`, `res` or cookies). HTTP concerns live in controllers and middleware, so other entry points, such as the future Socket.io handlers, can call the same services.
- Middleware used by a single feature lives in that feature's folder (for example `chatRoomAuth.middleware.ts`); `src/middlewares/` only holds middleware shared across features.
- Session handling is split in two: `modules/account/session.service.ts` talks to the database, and `middlewares/SessionCookie.ts` reads, sets and clears the cookie.
- Background jobs live in the folder of the feature they belong to and are started from `server.ts`, never from `app.ts`, so tests that import the app do not start timers.
- Tests live in `server/test/`, in a folder per feature that mirrors `src/modules/` (`test/account/`, `test/chatrooms/`), and import from `../../src/...`. Shared fixtures live in `test/helpers/`. `loginAs(user)` creates the session row and sends its cookie directly, so no test outside `test/account/` depends on `/account/login` or its rate limiter.
- Each test file covers what its part of the code owns: an endpoint file covers that endpoint's business rules plus one bad-input case to prove the validator is wired in; the full list of bad inputs is a table in `chatRoom.validator.unit.test.ts` (no database); `chatRoom.permissions.test.ts` covers the shared guards once per route, so a new route should be added to its lists. Keep a new test only if it guards a rule that is not already covered by another one.
- `npm run build` runs `tsc` and then `scripts/fix-esm-imports.mjs`. The source keeps extensionless imports, but Node's ESM loader needs real file names, so the script rewrites the relative imports in `dist/` (`./app` becomes `./app.js`, a folder import becomes `./dir/index.js`) and fails the build if an import points at nothing. `npm start` runs `node dist/server.js`.

## Empty chat room cleanup

A room whose last member has left is not deleted on the spot. `DELETE /chatrooms/:chatid/members/:userid` stamps the room's `emptied_at` column in the same transaction as the removal, and a job running inside the API process deletes the room once it has stayed empty for the retention period. Deleting the room cascades to its messages.
The job is `modules/chatrooms/chatRoomCleanup.job.ts` (timer, validation of the two settings below) and the database work is `chatRoomCleanup.service.ts` (`purgeExpiredEmptyChatRooms`).

- `EMPTY_ROOM_RETENTION_MS`: how long a room stays empty before it is deleted (default 7 days)
- `EMPTY_ROOM_CLEANUP_INTERVAL_MS`: how often the job looks for expired rooms (default 1 hour); it also sweeps once when the server starts
- each sweep first stamps any empty room that has no `emptied_at` yet (for example when every member's account was deleted), so its retention clock starts then, and then deletes rooms whose stamp is older than the retention period
- a room that has members is never deleted, whatever its `emptied_at` says
- the job is started from `server.ts`, not `app.ts`, so tests that import the app do not start a timer
- a room with no members cannot be reached through the API (every `/chatrooms/:chatid` route requires membership), so nothing can add members back to a room that is waiting for cleanup

## Cookie / CORS Notes

When sending cookies from a frontend, the server must allow credentials and the frontend origin must be explicitly allowed.
Not set up yet: `cors` is not a dependency and `app.ts` does not use it. Add it before the frontend starts calling the API from `http://localhost:5173`.

Example Express setup:

```ts
app.use(cors({ origin: 'http://localhost:5173', credentials: true }));
```

Example frontend fetch:

```ts
fetch('http://localhost:3000/account/me', { credentials: 'include' });
```

## Backend Data Flow

The backend follows a layered request flow:

1.**Request parsing and routing**

- Express receives the request and parses JSON bodies with `express.json()`.
- `cookie-parser` makes the session cookie available through `req.cookies`.
- The request is sent to the matching route under `/account` or `/chatrooms`.

2.**Authentication**

- Account signup and login validate the incoming body in their controllers before calling the account services.
- Login verifies the password, then `createSession` (`session.service.ts`) deletes the user's expired sessions and stores a new one, and `setSessionCookie` (`middlewares/SessionCookie.ts`) sends the session cookie in the response.
- Protected chat-room routes run `requireUserAuth`, which calls `getSessionUser` in `middlewares/SessionCookie.ts`: it reads the session cookie, resolves it through `findSessionUser` in `session.service.ts`, clears the cookie when the session has expired, and returns the user, which `requireUserAuth` attaches to `req.user`.
- `/account/me` uses the same `getSessionUser` lookup but returns `user: null` when no valid session exists. Logout deletes the session when present and clears the cookie.

3.**Route-level authorization**

- For routes containing `:chatid`, `loadChatMembership` checks the authenticated user's membership and the room type in one Prisma query.
- A valid membership is attached to `req.chatMembership` with the room ID, role, and room type.
- `requireGroupRoom` restricts group-only actions, while `requireChatAdmin` restricts administrative actions. Requests that fail these checks end before reaching the controller.

4.**Validation and controller handling**

- Controllers validate request bodies and URL parameters, then pass normalized values to the relevant service.
- Controllers coordinate the HTTP response: they choose the status code, select the response shape, and pass unexpected errors to the shared error handler.

5.**Service and database flow**

- Services contain all database operations and use the shared Prisma client from `src/lib/prisma`. They do not import Express.
- Account services create and find users. The session service creates, reads, and deletes sessions (rows only; cookies are handled in `middlewares/SessionCookie.ts`).
- Chat-room services create rooms and memberships in a Prisma transaction, load direct and group rooms, retrieve the latest message for room summaries, and update or delete rooms.
- Direct-room responses derive the room name and avatar from the other member; group-room responses use the room's own name and avatar fields.

6.**Response and error flow**

- Successful service results are mapped to JSON responses by the controller and returned to the client.
- Validation and authorization failures return directly from the relevant controller or middleware with an appropriate `4xx` status.
- Unexpected service or Prisma errors are forwarded with `next(error)` and handled by the application's final error-handler middleware.

For a typical protected request, the flow is:

```text
HTTP request
  -> Express JSON/cookie parsing
  -> route matching
  -> session lookup and req.user
  -> chat membership lookup and req.chatMembership
  -> role/type guards
  -> controller validation
  -> service
  -> Prisma/PostgreSQL
  -> controller response
```

## Roadmap

1. Complete message editing and deletion APIs for direct and group rooms
2. Add friend list and request flows with membership enforcement
3. Implement real-time communication with Socket.io
4. Build the React frontend and integrate with TanStack Query
5. Add authentication-aware UI states and protected routes
6. Add deployment configuration and production hardening

## Notes

This document reflects the current state of the repository. The auth module and the core chat-room backend are in place and working;
the remaining messaging feature set is planned as incremental extension work for the app.
