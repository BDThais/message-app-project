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

Claude's chat sandbox has no Docker and cannot download Prisma's schema engine, so `npm test` does not work there; the workaround (a local Postgres plus applying the migration SQL by hand) and other notes for working on this repo from that sandbox are in `CLAUDE_SANDBOX_NOTES.md`.

## Current Implementation Status

The backend is now at a broader API MVP than the original plan. The active implementation includes the account lifecycle and the room-management layer required for chat features:

Completed:

- POST /account/signup
- POST /account/login
- GET /account/me
- POST /account/logout
- POST /chat
- GET /chat
- GET /chat/:chatid
- PATCH /chat/:chatid
- DELETE /chat/:chatid
- POST /chat/:chatid/member
- DELETE /chat/:chatid/member/:userid
- PATCH /chat/:chatid/member/:userid
- POST /chat/:chatid/message
- GET /chat/:chatid/message
- PATCH /chat/:chatid/message/:message_id
- DELETE /chat/:chatid/message/:message_id
- GET /friend/search/:tel
- POST /friend/requests
- GET /friend/requests
- Chat membership validation and admin/role enforcement
- Direct-room reuse and group-room creation flows
- Basic room summaries with latest-message metadata
- Automatic cleanup of chat rooms that stay empty (see "Empty chat room cleanup")
- Integration tests for the account endpoints, the chat-room endpoints, the empty-room cleanup, the friend search endpoint, the send-friend-request endpoint and the list-friend-requests endpoint

Still planned or not yet implemented:

- Friend request flows (accept, reject/cancel)
- Friend list and unfriending
- Real-time socket communication
- Frontend application screens and state management
- Production deployment hardening

The room and auth systems are now acting as the current working backend foundation. The rest of the friend features (everything under "Friend endpoints" except search, sending a request and listing requests) and realtime remain future work and should be treated as the next milestone rather than as missing pieces of the current baseline.

Note: In the database, the mutual friendship model stores two rows per friendship pair, one for each user, as described in the project requirements.

## Permission model

| Action                  | admin | member |
| ----------------------- | :---: | :----: |
| Send / read messages    |  ✅   |   ✅   |
| Edit own message        |  ✅   |   ✅   |
| Delete own message      |  ✅   |   ✅   |
| Update room name/avatar |  ✅   |   ❌   |
| Delete room             |  ✅   |   ❌   |
| Add members             |  ✅   |   ❌   |
| Remove other members    |  ✅   |   ❌   |
| Leave the room          |  ✅   |   ✅   |
| Promote/demote a member |  ✅   |   ❌   |

Implemented so far: update, delete, add members, remove members, leave, promote/demote, sending messages, reading messages, and editing and deleting a message (sender only - no admin-moderation override for other members' messages).

## API Status

### Auth endpoints (implemented)

POST /account/signup

- Creates a new user account
- Validates name, email, tel, and password
- Checks for duplicate email or phone number
- Stores `tel` in its canonical E.164 spelling (`+` and digits only), not as typed: `isValidPhoneNumber` accepts spaces, dashes, parentheses, non-ASCII digits and extensions, and the unique constraint compares raw strings, so `+1 (415) 555-2671` and `+14155552671` would otherwise both register, and `GET /friend/search/:tel` (an exact match) could never find the first. `normalizeTel` in `signup.validator.ts` validates with `isValidPhoneNumber` (so the set of accepted numbers is unchanged) and then takes `parsePhoneNumberFromString(tel).number`; an extension is dropped. The duplicate check and the insert both use the normalized number, so another spelling of a registered number answers `409`
- Numbers stored before this change are rewritten by `npm run db:normalize-tels` (`scripts/normalize-tels.mjs`, run from `server/` against the database in `DATABASE_URL`). It is a dry run that lists the changes; add `-- --apply` to write them, in one transaction. It never touches a number that is no longer valid or accounts that would end up with the same number: it lists them, exits with code `1`, and leaves the merge or delete to you
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

- responds `400` with `{ "error": ... }` when validation fails and `409` when the email or phone number is already taken (in any spelling of the number)

POST /account/login

- Validates the supplied email/password
- Returns a generic invalid credentials message for both failed user and password checks
- Deletes any expired session already stored for the same user
- Creates a new session and sets the session cookie
- Rate limited to 10 attempts per 15 minutes per IP (`429` with `{ "error": ... }` afterwards); `loginLimiter` lives in `modules/account/accountRateLimit.middleware.ts`
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

POST /chat (implemented)

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

GET /chat (implemented)

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

GET /chat/:chatid (implemented)

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

PATCH /chat/:chatid (implemented)

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

DELETE /chat/:chatid (implemented)

- delete the room; cascades to its messages and memberships automatically
- only valid for type: group rooms
- requires admin
- no response body (`204 No Content`)

POST /chat/:chatid/member (implemented)

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

DELETE /chat/:chatid/member/:userid (implemented)

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

PATCH /chat/:chatid/member/:userid (implemented)

- change a member's role in the given room
- only valid for type: group rooms
- requires admin
- incoming body: { role: 'admin' | 'member' }
- setting a member's role to the one they already hold is allowed and simply confirms it
- reject with 409 if the target is the room's only remaining admin, the new role is 'member', and other members are still present (the same only-admin invariant `DELETE /chat/:chatid/member/:userid` enforces on removal); this rule doesn't apply when the target is the room's only member
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

POST /chat/:chatid/message (implemented)

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
      "editedAt": null,
      "deletedAt": null,
      "sender": {
        "id": 1,
        "name": "JohnDoe",
        "avatarUrl": null
      }
    }
  }
  ```

- responds `400` when `content` is missing, blank, not a string, or over the length limit

GET /chat/:chatid/message?before=<message_id>&limit=50 (implemented)

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
        "editedAt": null,
        "deletedAt": null,
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

PATCH /chat/:chatid/message/:message_id (implemented)

- edit a message's content
- only the message's own sender may edit it, in direct or group rooms alike; there is no admin-moderation override for other members' messages (see the permission model above). Membership alone gets a request to the controller, the sender check happens in the service, same as deleting
- incoming body: `{ content }`, held to exactly the same rules as sending a message: a non-empty string (whitespace-only is rejected), trimmed and capped at 4000 characters
- incoming body:

  ```json
  {
    "content": "Hello, world!"
  }
  ```

- `:message_id` must be a positive integer, otherwise `400`
- a successful edit stamps `editedAt` (so clients can show an "edited" label) and leaves `createdAt` alone: the message keeps its place in the room's history and the room list keeps its order. When the edited message is the room's latest, `lastMessage` in the room summaries shows the new content
- saving the content the message already has (after trimming) is allowed and simply confirms it: `200` with the message as it is, and `editedAt` is not stamped, so nothing looks edited that didn't change
- only the current content is kept: there is no edit history and no edit time limit
- a deleted message can never be edited back to life: the write itself is conditional on the message not being deleted, so an edit racing with a delete gets the same `404` as an edit sent after it
- return body (`200`):

  ```json
  {
    "message": {
      "id": 1,
      "chatId": 1,
      "senderId": 1,
      "content": "Hello, world!",
      "createdAt": "2026-09-25T12:00:00.000Z",
      "editedAt": "2026-09-28T09:30:00.000Z",
      "deletedAt": null,
      "sender": {
        "id": 1,
        "name": "JohnDoe",
        "avatarUrl": null
      }
    }
  }
  ```

- responds `400` when `:message_id` is not a valid ID, or when `content` is missing, blank, not a string, or over the length limit
- responds `403` when the requester is not the message's sender
- responds `404` when the message does not exist, does not belong to this room, or was deleted

DELETE /chat/:chatid/message/:message_id (implemented)

- delete a message from the chat room; the default (and only) behavior is to delete the message for everyone in the room, not just the requester
- soft delete: the message row stays, but `content` is cleared and `deleted_at` is stamped, so it keeps its place in the room's history instead of leaving a gap in the id sequence; a later `GET /chat/:chatid/message` reports it with `content: ""` and a non-null `deletedAt`
- only the message's own sender may delete it, in direct or group rooms alike; there is no admin-moderation override for other members' messages (see the permission model above)
- `:message_id` must be a positive integer, otherwise `400`
- responds `204 No Content` (no response body) when the message was deleted
- responds `403` when the requester is not the message's sender
- responds `404` when the message does not exist in this room, does not belong to this room, or was already deleted
- deleting a message never deletes the underlying `ChatRoom` or affects other members' access to the room

#### Friend endpoints (in progress: schema changes, search, sending a request and listing requests are implemented)

Friend flows get their own module, `src/modules/friends/` (routes, controller, validator(s), service), mounted in `app.ts` behind `requireUserAuth` like the chat routes. A user is always returned to other users as `{ id, name, avatarUrl }`, never with `email` or `tel`.

Schema changes for this milestone (done, in migration `20260928120000_add_friend_request_created_at_and_receiver_index`):

- `PendingFriendRequest.createdAt` (`DateTime @default(now())`), needed to sort the inbox and to expire stale requests later
- `@@index([receiverId])` on `PendingFriendRequest`: the existing `@@unique([senderId, receiverId])` index only serves lookups that start with the sender, and the inbox query filters by receiver

ID conventions: `/friend/:id` takes a *user* ID. Every `/friend/requests/:id` route takes a *request* ID (`PendingFriendRequest.id`), not the other user's ID. With a user ID, `DELETE /friend/requests/:id` would be ambiguous when two users have sent each other a request at the same moment (reject theirs, or cancel yours?). Every `:id` must be a positive integer within the Postgres integer range, otherwise `400`.

GET /friend/search/:tel (implemented)

- look up one user by phone number, so the requester can send them a friend request
- `:tel` must be a full E.164 number, validated with the same libphonenumber-js rule signup uses (`400` otherwise), and it must also be in canonical spelling: a `+` followed by at most 15 digits, with no spaces, dashes, parentheses or extension. That rule alone (`isValidPhoneNumber`) also accepts `+1 (415) 555-2671` and `+14155552671x123`, and because the lookup is an exact string match, accepting them would answer "nobody found" for a number that is registered. It is a path parameter on purpose: `+` is kept as-is in a path (`/friend/search/+84912345678` and `/friend/search/%2B84912345678` both work), whereas in a query string `+` decodes to a space
- exact match only, so the endpoint can't be used to browse or list users. It still lets any signed-in user test whether a number is registered, which is inherent to phone lookup, so it is rate limited per user (30 per 15 minutes, `429` with `{ "error": ... }` afterwards; every request past the sign-in check counts, `400`s included) and returns nothing beyond what the friend UI needs
- `relationship` tells the client which button to show: `self`, `friend`, `request_sent`, `request_received` or `none`. For the two request states, `requestId` is included so the client can cancel or accept without another call. When more than one applies, the first of `self`, `friend`, `request_received`, `request_sent` wins; the two request states only coexist through the send-at-the-same-instant race described under `POST /friend/requests`, and `request_received` wins because accepting it clears both
- finding nobody is a normal outcome, not an error: `200` with `user: null`
- return body (`200`):

  ```json
  {
    "user": {
      "id": 2,
      "name": "JaneDoe",
      "avatarUrl": null,
      "relationship": "request_received",
      "requestId": 7
    }
  }
  ```

POST /friend/requests (implemented)

- send a friend request; incoming body: `{ receiver_id }`
- incoming body:

  ```json
  {
    "receiver_id": 2
  }
  ```

- responds `400` when `receiver_id` is not a valid ID, is the requester's own ID, or does not refer to an existing user (the same convention as `member_ids` in `POST /chat`)
- responds `409` when the two are already friends, or when the requester already has a pending request to this user
- responds `409` when the receiver already sent the requester a request: deny it and point to the inbox flow instead. The body carries that request's `requestId` so the client can offer "Accept" directly
- rate limited per user (20 per hour, `429` with `{ "error": ... }` afterwards; like search, every request past the sign-in check counts, `400`s and `409`s included) to keep it from being used to spam
- a duplicate that slips past the checks (double click, two tabs) is caught by the unique constraint and answered with the same `409`
- return body (`201`), where `user` is the receiver:

  ```json
  {
    "request": {
      "id": 7,
      "createdAt": "2026-09-28T09:00:00.000Z",
      "user": {
        "id": 2,
        "name": "JaneDoe",
        "avatarUrl": null
      }
    }
  }
  ```

- known and accepted race: if two users send each other a request at the same instant, both can be stored (the unique constraint is per direction). This is harmless because accepting deletes the pair's requests in both directions (see below), so no hand-written database constraint is needed

GET /friend/requests (implemented)

- retrieve the requester's pending friend requests, newest first
- `direction` query parameter: `incoming` (default; requests others sent to the requester, the inbox) or `outgoing` (requests the requester sent, so the UI can show "request sent" and offer to cancel); `400` with `{ "error": "'direction' must be 'incoming' or 'outgoing'" }` for any other value, including an empty one (`?direction=`), a different case (`Incoming`) and a repeated parameter (`?direction=incoming&direction=outgoing`). Other query parameters are ignored
- `user` is always the *other* party: the sender for `incoming`, the receiver for `outgoing`. It is selected down to `{ id, name, avatarUrl }` in the query itself, so `email` and `tel` are never read
- sorted by `createdAt` descending, with the request `id` descending as the tie-break, so requests with the same timestamp always come back in the same order
- an empty list is a normal outcome: `200` with `requests: []`
- no pagination and no rate limiter: it only lists requests that already involve the requester, so it reveals nothing about other users. Add `limit`/`before` in the style of `GET /chat/:chatid/message` if an inbox can grow large
- return body (`200`):

  ```json
  {
    "requests": [
      {
        "id": 7,
        "createdAt": "2026-09-28T09:00:00.000Z",
        "user": {
          "id": 2,
          "name": "JaneDoe",
          "avatarUrl": null
        }
      }
    ]
  }
  ```

POST /friend/requests/:id/accept

- accept a pending friend request; `:id` is the request ID
- only the receiver can accept. Responds `404` when the request does not exist or is not addressed to the requester, so nobody can probe other users' requests
- in one transaction: create both `FriendListMember` rows (`createMany` with `skipDuplicates`, so it is safe to repeat), then delete every pending request between the two users in either direction
- does not create a chat room; the client calls `POST /chat` with `type: "direct"`, which reuses an existing room
- return body (`201`), where `friend` is the sender who is now a friend:

  ```json
  {
    "friend": {
      "id": 2,
      "name": "JaneDoe",
      "avatarUrl": null
    }
  }
  ```

DELETE /friend/requests/:id

- delete a pending friend request; `:id` is the request ID
- either party may call it: the receiver rejects, the sender cancels. Same effect, so one endpoint
- responds `204 No Content` when the request was deleted
- responds `404` when the request does not exist or the requester is neither its sender nor its receiver
- the other party is not notified of a rejection

GET /friend

- retrieve the requester's friends list, sorted by name (case-insensitive)
- no pagination yet (friend lists are small); add `limit`/`before` in the style of `GET /chat/:chatid/message` if that stops being true
- return body (`200`):

  ```json
  {
    "friends": [
      {
        "id": 2,
        "name": "JaneDoe",
        "avatarUrl": null
      }
    ]
  }
  ```

DELETE /friend/:id

- unfriend a user: delete both `FriendListMember` rows of the pair (`deleteMany` with an `OR` over the two directions, in one transaction)
- responds `204 No Content` when the friendship was removed
- responds `404` when the requester and `:id` are not friends
- leaves any existing direct room between the two users, and its messages, untouched; unfriending only stops new conversations if friendship is made a requirement (see "Friendship and messaging" below)

Friendship and messaging (decision needed)

Today `POST /chat` and `POST /chat/:chatid/member` accept any existing user ID, and user IDs are sequential integers, so anyone signed in can start a conversation with anyone. Friends have no effect on chat yet. Recommended, as its own step once the friend endpoints exist (it changes implemented endpoints and their tests):

- `POST /chat`: for a direct room the other user must be a friend of the requester; for a group room every `member_ids` entry, the same rule is applied
- `POST /chat/:chatid/member`: every added user must be a friend of the requester
- respond `403` and list the offending IDs (for example `notFriendIds`), and change nobody, in line with the all-or-nothing rule these endpoints already follow
- unfriending never removes anyone from an existing room. If harassment after unfriending becomes a concern, that is what a block feature would be for, and it is out of scope here

### Proposed additional endpoints (not yet implemented)

Gaps found by checking the API against the schema and against what the frontend will need. Roughly in priority order.

GET /chat/:chatid/member

- list the room's members; membership alone is required, direct or group. Today member lists only appear in the responses of room creation, add-members and change-role, so the frontend has no way to show who is in an existing room or to build the promote/remove screens
- admins first, then by name
- return body (`200`): `{ "members": [ ... ] }`, each entry in the member shape already used by `PATCH /chat/:chatid/member/:userid` (`memberId`, `chatId`, `role`, `lastReadMessageId`, `member: { id, name, avatarUrl }`)

PUT /chat/:chatid/read

- mark the room as read up to a message; incoming body: `{ message_id }`. `ChatMember.lastReadMessageId` already exists and is returned in every member payload, but nothing can set it
- `message_id` must be a valid ID of a message in this room (`400` for a bad ID, `404` otherwise; a soft-deleted message is still valid)
- the marker only moves forward: a `message_id` at or below the current one changes nothing and still returns `200`, so out-of-order requests from several tabs can't move it back. Implement as one conditional `updateMany` (`lastReadMessageId` is null or lower than the new value) rather than read-then-write
- return body (`200`): `{ "lastReadMessageId": 42 }` (the marker as it stands after the call)
- follow-up: add `unreadCount` to the room summaries of `GET /chat` and `GET /chat/:chatid`: messages in the room with an ID above `lastReadMessageId`, not sent by the requester and not deleted. The `(chatId, id)` index already covers it. Other members' `lastReadMessageId` values are also what a "seen by" indicator would be built from

PATCH /account/me

- update the requester's own profile; incoming body: `{ name?, avatar_url? }` with at least one. Same rules as signup's `name` and as `avatar_url` on `PATCH /chat/:chatid` (`null` clears it). `User.avatarUrl` is shown in every response but currently nothing can set it
- return body (`200`): `{ "user": { id, name, email, tel, avatarUrl } }`. The user shape returned by login and `GET /account/me` (and `req.user`) has no `avatarUrl` today, so it needs adding there too for the client to read the avatar back

POST /account/password

- change the password; incoming body: `{ current_password, new_password }`. `new_password` follows the signup password rules; `401` when `current_password` is wrong
- deletes the user's other sessions in the same transaction, so a leaked session stops working; the current session stays. Responds `204`
- lower priority, both worth doing before deployment: `DELETE /account/me` (the empty-room cleanup already accounts for deleted accounts, but no endpoint deletes one) and a password reset flow, which needs email delivery and so belongs with production hardening

Fixes to implemented endpoints:

- `lastMessage.content` in the room summaries is `""` when the latest message was deleted, so the room list would show a blank preview. Add `deletedAt` to `lastMessage` and let the client show a placeholder such as "Message deleted" (dropping deleted messages from the lookup instead would make a room jump down the list after a delete)
- signup controller's P2002 handler reports any unique violation as "Phone number already exists", even when the email is the cause

### Real-time events (planned)

Socket.io stays a notification layer on top of the REST endpoints rather than a second way to write data, so validation, permissions and tests are reused as they are:

- a controller (or a small `events` module) emits after the service call succeeds. Services keep returning a result the caller can inspect, like `editMessage`'s `edited` / `unchanged`, so only real changes are broadcast. Services still never import Socket.io
- handshake: read the session cookie and resolve it with the same `getSessionUser` lookup; reject the connection without a valid session
- on connect, the socket joins `user:<id>` (friend events, being added to a room) and `chat:<chatId>` for every room the user is a member of
- leaving, being removed, or a deleted room must also remove the affected sockets from `chat:<chatId>` (`socketsLeave`), otherwise a removed member keeps receiving that room's messages
- events: `message:new`, `message:updated` (payload identical to the `PATCH` response's `message`), `message:deleted` (`{ chatId, messageId, deletedAt }`), `chat:updated`, `chat:removed`, `member:added`, `member:removed`, `member:role_changed`, `read:updated`, `friend:request`, `friend:accepted`
- typing indicators are socket-only and never stored

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
    │   ├── normalize-tels.mjs       // one-off: rewrite stored users.tel to canonical E.164 (dry run unless --apply)
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
    │   │   ├── ErrorHandler.ts      // every error body is { error }; keeps the status of 4xx errors Express raises
    │   │   ├── SessionCookie.ts     // set/clear/read the session cookie
    │   │   └── UserSessionAuth.ts   // requireUserAuth
    │   └── modules/
    │       ├── account/
    │       │   ├── account.routes.ts
    │       │   ├── accountRateLimit.middleware.ts   // loginLimiter (per IP)
    │       │   ├── account.controller.ts
    │       │   ├── account.service.ts
    │       │   ├── session.service.ts   // session database operations
    │       │   ├── login.validator.ts
    │       │   └── signup.validator.ts
    │       ├── chatrooms/
    │       │   ├── chatRoom.routes.ts
    │       │   ├── chatRoom.controller.ts
    │       │   ├── chatRoom.validator.ts
    │       │   ├── chatRoomAuth.middleware.ts   // loadChatMembership, requireGroupRoom, requireChatAdmin
    │       │   ├── chatRoom.service.ts
    │       │   ├── chatMember.service.ts
    │       │   ├── message.service.ts
    │       │   ├── chatRoomCleanup.service.ts
    │       │   └── chatRoomCleanup.job.ts
    │       └── friends/
    │           ├── friend.routes.ts
    │           ├── friend.controller.ts
    │           ├── friend.validator.ts
    │           ├── friend.service.ts
    │           └── friendRateLimit.middleware.ts   // per-user limiters (friendSearchLimiter, friendRequestLimiter)
    └── test/
        ├── setup.ts
        ├── helpers/                          // shared fixtures, not test files
        │   ├── users.ts                      // createUser, loginAs (session cookie without going through /account/login)
        │   ├── chatRooms.ts                  // createGroupRoom, createDirectRoom, promoteToAdmin, memberIdsOf
        │   └── friends.ts                    // makeFriends, createFriendRequest (optional createdAt)
        ├── account/
        │   ├── session.test.ts               // login, me, logout
        │   └── signup.test.ts                // includes the canonical-number and duplicate-spelling cases
        ├── middlewares/                      // mirrors src/middlewares/
        │   ├── errorHandler.unit.test.ts     // the handler alone, with a fake response
        │   └── errorHandler.test.ts          // errors Express raises itself (malformed JSON, bad percent-encoding)
        ├── chatrooms/
        │   ├── chatRoom.test.ts              // create, list, get, update and delete a room
        │   ├── chatRoom.permissions.test.ts  // sign-in, membership, group-only and admin-only guards, per route
        │   ├── chatRoomMembers.add.test.ts
        │   ├── chatRoomMembers.remove.test.ts
        │   ├── chatRoomMessages.send.test.ts
        │   ├── chatRoomMessages.get.test.ts
        │   ├── chatRoomMessages.edit.test.ts
        │   ├── chatRoomMessages.delete.test.ts
        │   ├── chatRoom.validator.unit.test.ts
        │   ├── chatRoomCleanup.service.test.ts
        │   └── chatRoomCleanup.job.unit.test.ts
        └── friends/
            ├── friendSearch.test.ts          // GET /friend/search/:tel
            ├── friendRequests.send.test.ts   // POST /friend/requests
            ├── friendRequests.get.test.ts    // GET /friend/requests
            ├── friend.permissions.test.ts    // sign-in guard, per route
            └── friend.validator.unit.test.ts
```

Conventions:

- File names follow `<subject>.<role>.ts`, for example `chatRoom.service.ts` or `login.validator.ts`.
- A new feature gets its own folder under `src/modules/` with its routes, controller, validator(s) and service(s); its router is mounted in `app.ts`.
- All database operations are kept in the `*.service.ts` files and go through the shared Prisma client from `src/lib/prisma.ts`. There is no separate repositories layer, so a transaction (room creation, member removal) stays inside one service function.
- A fixed technical limit shared by more than one module (for example the Postgres INTEGER max, reused as both an ID ceiling and a `setInterval`/`setTimeout` delay ceiling) is declared once in `src/lib/constants.ts` and imported everywhere it's needed, instead of being redeclared per file.
- Services never import Express (no `req`, `res` or cookies). HTTP concerns live in controllers and middleware, so other entry points, such as the future Socket.io handlers, can call the same services.
- Middleware used by a single feature lives in that feature's folder (for example `chatRoomAuth.middleware.ts`, `accountRateLimit.middleware.ts`, `friendRateLimit.middleware.ts`); `src/middlewares/` only holds middleware shared across features. Rate limiters follow the same rule: each feature keeps its own limiters, keyed by IP where nobody is signed in yet (`loginLimiter`) and by user id after `requireUserAuth` (`friendSearchLimiter`).
- Error bodies: every `4xx` and `5xx` response has the shape `{ "error": "<text>" }`, whichever layer sends it (controller, feature middleware, rate limiter, `errorHandler`). `message` is not used for errors because it is already a success-body key for a chat message (`POST` and `PATCH /chat/:chatid/message` return `{ "message": { ... } }`), so a client could otherwise get a string and an object under the same key from one endpoint. Validators keep their own internal `{ valid: false, message }` result; the controller puts that text under `error`. A success body that only confirms an action (`201 { "message": "Account created successfully" }` from signup) is not an error body and is unchanged.
- Session handling is split in two: `modules/account/session.service.ts` talks to the database, and `middlewares/SessionCookie.ts` reads, sets and clears the cookie.
- Background jobs live in the folder of the feature they belong to and are started from `server.ts`, never from `app.ts`, so tests that import the app do not start timers.
- Tests live in `server/test/`, in a folder per feature that mirrors `src/modules/` (`test/account/`, `test/chatrooms/`, `test/friends/`; `test/middlewares/` mirrors `src/middlewares/`), and import from `../../src/...`. Shared fixtures live in `test/helpers/`. `loginAs(user)` creates the session row and sends its cookie directly, so no test outside `test/account/` depends on `/account/login` or its rate limiter.
- Each test file covers what its part of the code owns: an endpoint file covers that endpoint's business rules plus one bad-input case to prove the validator is wired in; the full list of bad inputs is a table in `chatRoom.validator.unit.test.ts` (no database); `chatRoom.permissions.test.ts` covers the shared guards once per route, so a new route should be added to its lists. Keep a new test only if it guards a rule that is not already covered by another one.
- `npm run build` runs `tsc` and then `scripts/fix-esm-imports.mjs`. The source keeps extensionless imports, but Node's ESM loader needs real file names, so the script rewrites the relative imports in `dist/` (`./app` becomes `./app.js`, a folder import becomes `./dir/index.js`) and fails the build if an import points at nothing. `npm start` runs `node dist/server.js`.

## Empty chat room cleanup

A room whose last member has left is not deleted on the spot. `DELETE /chat/:chatid/member/:userid` stamps the room's `emptied_at` column in the same transaction as the removal, and a job running inside the API process deletes the room once it has stayed empty for the retention period. Deleting the room cascades to its messages.
The job is `modules/chatrooms/chatRoomCleanup.job.ts` (timer, validation of the two settings below) and the database work is `chatRoomCleanup.service.ts` (`purgeExpiredEmptyChatRooms`).

- `EMPTY_ROOM_RETENTION_MS`: how long a room stays empty before it is deleted (default 7 days)
- `EMPTY_ROOM_CLEANUP_INTERVAL_MS`: how often the job looks for expired rooms (default 1 hour); it also sweeps once when the server starts
- each sweep first stamps any empty room that has no `emptied_at` yet (for example when every member's account was deleted), so its retention clock starts then, and then deletes rooms whose stamp is older than the retention period
- a room that has members is never deleted, whatever its `emptied_at` says
- the job is started from `server.ts`, not `app.ts`, so tests that import the app do not start a timer
- a room with no members cannot be reached through the API (every `/chat/:chatid` route requires membership), so nothing can add members back to a room that is waiting for cleanup

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
- The request is sent to the matching route under `/account`, `/chat` or `/friend`.

2.**Authentication**

- Account signup and login validate the incoming body in their controllers before calling the account services.
- Login verifies the password, then `createSession` (`session.service.ts`) deletes the user's expired sessions and stores a new one, and `setSessionCookie` (`middlewares/SessionCookie.ts`) sends the session cookie in the response.
- Protected chat-room and friend routes run `requireUserAuth`, which calls `getSessionUser` in `middlewares/SessionCookie.ts`: it reads the session cookie, resolves it through `findSessionUser` in `session.service.ts`, clears the cookie when the session has expired, and returns the user, which `requireUserAuth` attaches to `req.user`.
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
- Friend services look up users and the friend-list and pending-request rows that connect them to the requester. Other users are returned as `{ id, name, avatarUrl }` only, never with `email` or `tel`.

6.**Response and error flow**

- Successful service results are mapped to JSON responses by the controller and returned to the client.
- Validation and authorization failures return directly from the relevant controller or middleware with an appropriate `4xx` status and an `{ error }` body.
- Unexpected service or Prisma errors are forwarded with `next(error)` and handled by the application's final error-handler middleware.
- The error handler answers `500 { "error": "Internal server error" }` for those and logs them. An error that carries its own `4xx` status (Express and body-parser set one) is answered with that status instead: a malformed JSON body or a path param with broken percent-encoding, such as `/chat/%E0%A4%A` or `/friend/search/%E0%A4%A`, is a `400`, not a `500`. Such an error is the client's mistake, so it is not logged, and its text is only sent to the client when the error marks it as safe to expose (otherwise the plain status text, for example `Bad Request`).

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

1. Add friend list and request flows (see "Friend endpoints"), and decide whether friendship is required to start a chat
2. Close the REST gaps listed under "Proposed additional endpoints" (member list, mark as read and unread counts, profile update)
3. Implement real-time communication with Socket.io (see "Real-time events")
4. Build the React frontend and integrate with TanStack Query
5. Add authentication-aware UI states and protected routes
6. Add deployment configuration and production hardening

## Notes

This document reflects the current state of the repository. The auth module and the core chat-room backend are in place and working;
the remaining messaging feature set is planned as incremental extension work for the app.
