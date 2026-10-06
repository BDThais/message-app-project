# Message App Project Planning & Progress

## Overview

This project is a real-time messaging application built with PostgreSQL, Prisma, TypeScript, Express.js, and a React frontend.
The backend has grown beyond the original account/session MVP and now includes a working chat-room foundation with direct and group room support, while the realtime features are still planned work.

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
- PATCH /account/me
- POST /account/password
- DELETE /account/me
- POST /chat
- GET /chat
- GET /chat/:chatid
- PATCH /chat/:chatid
- DELETE /chat/:chatid
- GET /chat/:chatid/member
- POST /chat/:chatid/member
- DELETE /chat/:chatid/member/:userid
- PATCH /chat/:chatid/member/:userid
- POST /chat/:chatid/message
- GET /chat/:chatid/message
- PATCH /chat/:chatid/message/:message_id
- DELETE /chat/:chatid/message/:message_id
- PUT /chat/:chatid/read
- GET /friend/search/:tel
- POST /friend/requests
- GET /friend/requests
- POST /friend/requests/:id/accept
- DELETE /friend/requests/:id
- GET /friend
- DELETE /friend/:id
- Chat membership validation and admin/role enforcement
- Direct-room reuse and group-room creation flows
- Friendship requirement for creating a room and adding members (see "Friendship and messaging")
- Basic room summaries with latest-message metadata
- Automatic cleanup of chat rooms that stay empty (see "Empty chat room cleanup")
- Integration tests for the account endpoints (including profile update, password change and account deletion), the chat-room endpoints, the empty-room cleanup, the friend search endpoint, the send-friend-request endpoint, the list-friend-requests endpoint, the accept-friend-request endpoint, the reject/cancel-friend-request endpoint, the list-friends endpoint, the unfriend endpoint and the friendship requirement for creating rooms and adding members

Still planned or not yet implemented:

- Email delivery, email verification and password reset by email (see "Email delivery (planned)", "Email verification (planned)" and "Password reset (planned)"); the database tables for verification already exist
- Real-time socket communication
- Frontend application screens and state management
- Production deployment hardening

The room and auth systems are now acting as the current working backend foundation. The friend endpoints are all in place, so realtime is the next milestone and remains future work rather than a missing piece of the current baseline.

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
| List members, mark read |  ✅   |   ✅   |
| Promote/demote a member |  ✅   |   ❌   |

Implemented so far: update, delete, add members, remove members, leave, promote/demote, listing the members, marking a room as read (each member moves only their own marker), sending messages, reading messages, and editing and deleting a message (sender only - no admin-moderation override for other members' messages).

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
- Creates a new session and sets the session cookie. The session id is 32 random bytes from `crypto.randomBytes`, base64url-encoded (43 characters), made by `generateToken` (`src/lib/randomToken.ts`) in `createSession`; `sessions.id` has no default in the schema, so a session cannot be created without one. Sessions created before this change keep their old ids and work until they expire; to sign everybody out at once, run `DELETE FROM sessions;`
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
      "tel": "+1234567890",
      "avatarUrl": null
    }
  }
  ```

GET /account/me

- Returns the current authenticated user or null if there is no session. `avatarUrl` is `null` until `PATCH /account/me` sets it
- return body:

  ```json
  {
    "user": {
      "id": 1,
      "name": "JohnDoe",
      "email": "john@example.com",
      "tel": "+1234567890",
      "avatarUrl": null
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

PATCH /account/me (implemented)

- Updates the requester's own profile. Requires a session (`401 { "error": "Unauthorized Access" }` otherwise)
- incoming body: `{ name?, avatar_url? }` with at least one, otherwise `400`. Only the fields that are sent change; unknown fields (`email`, `tel`, `password`...) are ignored
- `name` follows signup's rule (letters and numbers only) and must be a non-empty string. `avatar_url` follows the rule on `PATCH /chat/:chatid`: an `http:` or `https:` URL, or `null` to clear it. The two checks that both validators need (`isValidHttpUrl`, `isRecord`) live in `src/lib/validation.ts`
- return body (`200`), the same user shape that login and `GET /account/me` return:

  ```json
  {
    "user": {
      "id": 1,
      "name": "JohnDoe2",
      "email": "john@example.com",
      "tel": "+1234567890",
      "avatarUrl": "https://example.com/john.png"
    }
  }
  ```

- `avatarUrl` is now part of the user shape everywhere: `findSessionUser` selects it, so `GET /account/me` and `req.user` carry it, and login returns it. Changing `email` or `tel` is not supported
- responds `400` with `{ "error": ... }` when validation fails. Validation lives in `profile.validator.ts`

POST /account/password (implemented)

- Changes the requester's password. Requires a session (`401 { "error": "Unauthorized Access" }` otherwise)
- incoming body: `{ current_password, new_password }`, both non-empty strings (`400` otherwise). `new_password` follows the signup password rules (`400` with the same messages as signup). Validation lives in `password.validator.ts`
- `401 { "error": "Current password is incorrect" }` when `current_password` is wrong; nothing changes. The same `401` is sent if the password was changed by another request between the check and the write: `changePassword` (`account.service.ts`) only writes when the stored hash is still the one that was verified, so a stale "current password" cannot overwrite a newer one
- in one transaction, stores the new hash and deletes all the user's other sessions (expired ones too), so a leaked session stops working. The session making the request stays valid, and other users' sessions are untouched
- responds `204` with no body. A new password equal to the current one is accepted (the other sessions are still signed out)
- rate limited to 10 attempts per 15 minutes per user (`429 { "error": "Too many attempts, try again later" }` afterwards), because otherwise a stolen session cookie could guess the password here without the limit login has. `passwordCheckLimiter` lives in `modules/account/accountRateLimit.middleware.ts`, is keyed by user id, and so is mounted after `requireUserAuth`. Every request that gets past `requireUserAuth` counts, including ones answered with a `400`. `DELETE /account/me` uses the same limiter instance, so the two routes share one budget

DELETE /account/me (implemented)

- Deletes the requester's own account. Requires a session (`401 { "error": "Unauthorized Access" }` otherwise)
- incoming body: `{ password }`, the account's current password, a non-empty string (`400 { "error": "Password is required" }` otherwise). It is asked for the same reason `POST /account/password` asks for the current one: deleting is irreversible, so a session cookie alone (a stolen one, or a browser left signed in) must not be enough. Validation lives in `deleteAccount.validator.ts`
- `401 { "error": "Password is incorrect" }` when the password is wrong; nothing changes. The same `401` is sent if the password was changed by another request between the check and the delete: `deleteAccount` (`account.service.ts`) only deletes when the stored hash is still the one that was verified, like `changePassword`
- `409` when the requester is the only admin of a group room that still has other members: the only-admin rule of `DELETE /chat/:chatid/member/:userid`, applied to the whole account, so a room with members always keeps an admin. Nothing is deleted, not even the rooms where the requester is only a member. The user can make someone else an admin (`PATCH /chat/:chatid/member/:userid`) or delete the room (`DELETE /chat/:chatid`) and try again. The body lists the rooms so the client can send the user there (`chatIds` is the one extra key an error body carries):

  ```json
  {
    "error": "You are the only admin of a group room that still has other members. Make someone else an admin or delete the room first",
    "chatIds": [3, 8]
  }
  ```

  Direct rooms are exempt (both members are admins), and so are group rooms where the requester is the only member
- everything runs in one transaction. The foreign keys delete the user's sessions (all of them, expired ones too), room memberships, friend-list entries (in both directions) and friend requests (sent and received). The user's messages stay in their rooms with `senderId` and `sender` set to `null`, so the other members keep the conversation; nobody can edit or delete such a message afterwards, because both are sender-only. A direct room stays with its remaining member, who still lists and reads it (its `name` and `avatarUrl` are `null`, as when the other member leaves)
- a room whose only member was the requester gets `emptied_at` in the same transaction, so the retention clock of the cleanup job starts right away (see "Empty chat room cleanup")
- every room the requester is in is locked (`SELECT ... FOR UPDATE`, in id order so two deletions that share rooms cannot deadlock) before the admin check, for the same reason as on `DELETE /chat/:chatid/member/:userid`: two admins of one room deleting their accounts at the same moment could otherwise both pass the check and leave the room with members but no admin
- responds `204` with no body and clears the session cookie. The email and phone number can be used to sign up again
- rate limited with `POST /account/password`: the two routes share one budget of 10 attempts per 15 minutes per user (`429 { "error": "Too many attempts, try again later" }` afterwards), because both let whoever holds a session guess the password

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
- every `member_ids` entry must be an integer from 1 to 2147483647 and a friend of the requester (see "Friendship and messaging"); a group room with no `member_ids` needs no friends
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
- responds `201` when a new room is created and `200` when an existing direct room between the same two friends is reused
- responds `400` on validation errors
- each entry of `members` is `{ chatId, role, lastReadMessageId, member: { id, name, avatarUrl } }`. The user is only under `member`: there is no separate `memberId`, it would repeat `member.id`. `GET /chat/:chatid/member`, `POST /chat/:chatid/member` and `PATCH /chat/:chatid/member/:userid` return entries of the same shape
- responds `403` with `{ "error": "Only your friends can be added to a chat room" }` when any `member_ids` entry is not a friend of the requester, or does not exist (the two are not told apart), and creates no room and no members. For a direct room this check comes before the lookup of an existing room, so two former friends get `403` here, not their old room back
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

GET /chat/:chatid/member (implemented)

- list the room's members; membership alone is required, in direct or group rooms alike (no group-only or admin-only guard on this route). It is how the frontend shows who is in an existing room and builds the promote/remove screens: member lists otherwise only appear in the responses of room creation, add-members and change-role
- admins first, then by name. Names are compared ignoring case and accents (`bea` comes before `Carl`), and the order does not depend on the database's collation because the sort is done in the service. Members whose names compare equal keep user-ID order
- every member of the room is returned; there is no pagination
- return body (`200`): `{ "members": [ ... ] }`, each entry in the member shape already used by `PATCH /chat/:chatid/member/:userid` (`chatId`, `role`, `lastReadMessageId`, `member: { id, name, avatarUrl }`):

  ```json
  {
    "members": [
      {
        "chatId": 1,
        "role": "admin",
        "lastReadMessageId": 7,
        "member": {
          "id": 1,
          "name": "Alice",
          "avatarUrl": null
        }
      },
      {
        "chatId": 1,
        "role": "member",
        "lastReadMessageId": null,
        "member": {
          "id": 2,
          "name": "Bob",
          "avatarUrl": null
        }
      }
    ]
  }
  ```

POST /chat/:chatid/member (implemented)

- add one or many existing user to the room
- only valid for type: group rooms
- requires admin
- incoming body: { member_ids }
- new members are inserted with role: member
- `member_ids` is required: a non-empty array of positive integer user IDs (duplicates are ignored)
- users who are already members (including the requester) are skipped and left unchanged, so an existing admin is never demoted; their IDs are returned in `alreadyMemberIds`
- every user who would be *added* must be a friend of the requester (see "Friendship and messaging"). If any of them is not a friend, or does not exist (the two are not told apart), respond `403` with `{ "error": "Only your friends can be added to a chat room" }` and add nobody from that request. Users who are already members are not checked, so they are skipped even if they are no longer friends
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

PUT /chat/:chatid/read (implemented)

- mark the room as read up to a message, for the requester only: it sets the requester's own `ChatMember.lastReadMessageId`, which every member payload returns. Other members' markers are never touched. Membership alone is required, in direct or group rooms alike (no group-only or admin-only guard on this route)
- incoming body: `{ "message_id": 42 }`. `message_id` is a JSON number (like the ids in `member_ids`): a positive integer within the Postgres integer range, otherwise `400`
- responds `404` with `{ "error": "Message not found in this chat room" }` when no message with this id exists in this room; a message of another room gets the same answer. A soft-deleted message is still valid, because it keeps its place in the room's history
- the marker only moves forward: a `message_id` at or below the current marker changes nothing and still returns `200`, so out-of-order requests from several tabs can't move it back. It is one conditional `updateMany` (`lastReadMessageId` is null or lower than the new value) rather than read-then-write, so requests racing each other end at the highest id. The marker is read afterwards only when the update changed nothing
- return body (`200`): `{ "lastReadMessageId": 42 }` (the marker as it stands after the call, which is the later message when the marker was already ahead)
- if the requester left the room while the request was running, it answers `404` with `{ "error": "Chat room not found" }`, the same as the membership check

#### Friend endpoints (implemented)

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

- responds `400` when `receiver_id` is not a valid ID, is the requester's own ID, or does not refer to an existing user (unlike `POST /chat`, which answers `403` for an unknown user and a stranger alike)
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

POST /friend/requests/:id/accept (implemented)

- accept a pending friend request; `:id` is the request ID (`400` with `{ "error": "Invalid friend request id" }` when it is not a valid ID)
- only the receiver can accept. Responds `404` with `{ "error": "Friend request not found" }` when the request does not exist or is not addressed to the requester, so nobody can probe other users' requests. A request that was already accepted is gone, so repeating the call answers `404`
- in one transaction: create both `FriendListMember` rows (`createMany` with `skipDuplicates`, so it is safe to repeat and completes a friendship that only has one of its two rows), then delete every pending request between the two users in either direction
- the two rows are always created in the same order (lower user ID first), whoever accepts. Two users who sent each other a request at the same instant can also accept at the same instant, and if each transaction inserted its own side first, Postgres could abort one of them as a deadlock
- a double click or a second tab sending the same accept twice at once is answered with `201` and `201`, or `201` and `404`, never a `5xx`; either way there is one friendship and no request left
- no rate limiter: it only works on a request addressed to the requester, so it reveals nothing about other users
- if the sender's account is deleted while the request is being accepted, the answer is the same `404`
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

DELETE /friend/requests/:id (implemented)

- delete a pending friend request; `:id` is the request ID (`400` with `{ "error": "Invalid friend request id" }` when it is not a valid ID)
- either party may call it: the receiver rejects, the sender cancels. Same effect, so one endpoint
- responds `204 No Content` with no body when the request was deleted
- responds `404` with `{ "error": "Friend request not found" }` when the request does not exist or the requester is neither its sender nor its receiver. The two are not told apart, so nobody can probe other users' requests (the same answer `POST /friend/requests/:id/accept` gives)
- it deletes only the request `:id` names. When two users sent each other a request at the same instant, the other request of the pair stays: it is a different request (which is why `:id` is a request ID and not a user ID), and accepting it still clears the pair
- the permission check and the delete are one `deleteMany` statement narrowed to requests the requester is a party to, not a lookup followed by a delete. A double click or a second tab sending the same call twice at once, or the sender cancelling while the receiver rejects, is therefore answered with `204` and `404`, never a `5xx`; either way the request is gone
- no rate limiter: it only works on a request the requester is a party to, so it reveals nothing about other users
- the other party is not notified of a rejection, and nothing is recorded about it: there is no "rejected" state and no block, so afterwards either user can send the other a new request

GET /friend (implemented)

- retrieve the requester's friends list, sorted by name (case-insensitive). Names that differ only in case (`bob` and `Bob`) are ordered by user ID, so the order never changes from one call to the next
- it reads the requester's *own* friend-list rows, the same rows `GET /friend/search/:tel`, `DELETE /friend/:id` and the friendship check of the chat-room endpoints read, so every endpoint agrees on who is a friend. A half-written friendship (only one of the two rows, which the API itself never produces) is therefore listed for the user whose row exists and not for the other
- each friend is selected down to `{ id, name, avatarUrl }` in the query itself, so `email` and `tel` are never read
- the sort is done in `listFriends`, not by the database: Prisma cannot order by `lower(name)`, and a plain `orderBy` follows the database's collation, which differs between installations (a case-sensitive one puts every capitalised name before every lower-case one). Names are letters and digits only, so lower-casing them is enough. When the list gets `limit`/`before`, the order has to move into the query (a raw `ORDER BY lower(name), id`)
- an empty list is a normal outcome: `200` with `friends: []`
- no rate limiter: it only lists the requester's own friends, so it reveals nothing about other users
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

DELETE /friend/:id (implemented)

- unfriend a user: delete both `FriendListMember` rows of the pair (`deleteMany` with an `OR` over the two directions, in one transaction). `:id` is a *user* ID (`400` with `{ "error": "Invalid user id" }` when it is not a valid ID)
- responds `204 No Content` with no body when the friendship was removed. Either friend can call it, and both rows go whoever does
- responds `404` with `{ "error": "You are not friends with this user" }` when the requester and `:id` are not friends. Two users are friends when the *requester's own* row names `:id`, the same row `GET /friend` and `GET /friend/search/:tel` read. A user who does not exist, a stranger and the requester's own ID all get this same `404`, so nobody can probe which user IDs exist. A half-written friendship (only one of the two rows, which the API itself never produces) is therefore removed, both rows, by the user whose row exists, and answers `404` for the user whose row is missing
- no rate limiter: it only works on the requester's own friend list, so it reveals nothing about other users
- a double click or a second tab sending the same request twice at once, or both friends unfriending each other at the same instant, is answered with `204` and `204`, or `204` and `404`, never a `5xx` (unlike accepting, the two rows are removed by one `DELETE` statement, so no fixed row order is needed); either way the friendship is gone
- does not touch pending friend requests (a pair that are friends has none, because accepting clears them), so after unfriending either user can send the other a new request
- leaves any existing direct room between the two users, and its messages, untouched, and they can keep messaging in it. What unfriending stops is new conversations between them: a new direct room, or adding one to a group of the other (see "Friendship and messaging" below)

Friendship and messaging (implemented)

Friendship is required to start a conversation. Before this rule `POST /chat` and `POST /chat/:chatid/member` accepted any existing user ID, and user IDs are sequential integers, so anyone signed in could start a conversation with anyone, and read their name and avatar from the response. The rules:

- `POST /chat`: for a direct room the other user must be a friend of the requester; for a group room every `member_ids` entry must be (the requester's own ID is dropped first, as before). A group room created with no `member_ids` needs no friends
- `POST /chat/:chatid/member`: every user who would be *added* must be a friend of the requester. A user who is already a member (the requester included) is skipped as before, friend or not, so a repeated request does not start failing because of someone who is already in the room
- "friend" means the requester's *own* friend-list row names the user, the same rule `GET /friend`, `GET /friend/search/:tel` and `DELETE /friend/:id` use. The members of a group do not have to be friends with each other, only with whoever adds them
- respond `403` with `{ "error": "Only your friends can be added to a chat room" }` and change nobody, in line with the all-or-nothing rule these endpoints already follow: one user who is not a friend refuses the whole request, and a room is never created without its members. The check runs after validation (`400`) and, on `POST /chat/:chatid/member`, after the group-room and admin guards (`403` with their own bodies)
- a user ID that does not exist gets the same `403` as a stranger, so nobody can probe which user IDs exist. This replaces the old `400` for an unknown ID on these two endpoints. A member ID below 1 or above 2147483647 is still a `400` on both, because the database would refuse the lookup (`POST /chat` used to answer `500` for such an ID)
- for a direct room the check comes before the lookup of an existing room: two former friends get `403` from `POST /chat`, not their old room back with `200`. The room itself is untouched
- unfriending never removes anyone from an existing room, and the room keeps working: the former friends can still read and send messages in it, and `GET /chat` still lists it. What it stops is *new* conversations: a new direct room, or adding that user to a group. If harassment after unfriending becomes a concern, that is what a block feature would be for, and it is out of scope here
- the check is not locked against a concurrent unfriend: a friendship removed at the same instant counts as the friendship it was when checked. A user deleted after the check but before the insert fails the foreign key and gets the same `403`
- the check lives in `findNonFriendIds` (`friend.service.ts`), which the chat-room services call; it is the only place where the chat-room module reads the friend list

### Proposed additional endpoints (not yet implemented)

Gaps found by checking the API against the schema and against what the frontend will need. Roughly in priority order.

`unreadCount` on `GET /chat` and `GET /chat/:chatid`

- add `unreadCount` to the room summaries: messages in the room with an ID above the requester's `lastReadMessageId` (which `PUT /chat/:chatid/read` sets), not sent by the requester and not deleted. The `(chatId, id)` index already covers it. Other members' `lastReadMessageId` values (listed by `GET /chat/:chatid/member`) are also what a "seen by" indicator would be built from

Fixes to implemented endpoints:

- `lastMessage.content` in the room summaries is `""` when the latest message was deleted, so the room list would show a blank preview. Drop deleted messages from the lookup instead so the preview will show the message before the deleted message
- signup controller's P2002 handler reports any unique violation as "Phone number already exists", even when the email is the cause

### Email delivery (planned)

Shared by email verification and password reset. Nothing here is implemented yet.

- **Provider: Resend**, through its official `resend` package (`new Resend(apiKey).emails.send({ from, to, subject, text })`). It is one API key and one HTTPS call, with no SMTP host, port or TLS settings, and no trouble on hosts that block outbound SMTP. Its free plan (3,000 emails a month, at most 100 a day, one domain, per Resend's pricing page when this was written) is far above what a personal project sends. Nodemailer was the alternative, but it is only a library for talking SMTP, so choosing it would still mean choosing an SMTP provider; the `Mailer` interface below keeps the provider replaceable (a Nodemailer implementation would be one more file).
- **What it costs:** sending to real users needs a domain you own, verified in Resend by adding the DNS records it lists (SPF and DKIM). Until then `onboarding@resend.dev` can only deliver to the address of the Resend account itself and answers `403` for anyone else, so real emails can be tried end to end only with your own address.
- The Resend SDK does not throw on API errors: `emails.send` resolves to `{ data, error }`. The Resend mailer must check `error` and throw, otherwise failed sends disappear silently.
- `src/lib/mailer.ts` holds the `Mailer` interface (`send({ to, subject, text }): Promise<void>`), a console mailer that only logs (the default outside production), the Resend mailer, and `getMailer` / `setMailer` so tests can swap in an in-memory outbox (`test/helpers/mailer.ts`, emptied in `setup.ts`'s `beforeEach`).
- New settings in `config.ts`, validated when the server starts like the cleanup job's: `MAIL_TRANSPORT` (`console` | `resend`; default `console`, and `resend` is required when `NODE_ENV=production`), `RESEND_API_KEY` and `MAIL_FROM` (for example `Message App <no-reply@yourdomain.com>`). `resend` without a key or a `MAIL_FROM` stops the server at start.
- A request never waits for the mail: the controller responds first, then sends inside a `try/catch` that logs a failure. The response time must not show whether a mail was sent (the reset flow depends on that), and a provider outage must not turn signup into a `500`. The price is that a failed mail is lost and the user asks again; if that proves too unreliable, the next step is an outbox table drained by a job like the cleanup job.
- Mails are plain text: one sentence of context and the link.

### Email verification (planned)

Goal: prove that the owner of an account can read mail sent to its address. An unverified address can be a typo or someone else's, and a password reset link takes over an account, so reset must not be sent to an address nobody has proven. Of this section, only the database changes exist so far.

Database (in place, migration `20261004120000_add_email_verification`):

- `users.email_verified_at`, a nullable timestamp: `null` means unverified. Existing accounts are not backfilled, because that would claim proof nobody gave: they start unverified and verify by asking for an email after logging in.
- `email_verification_tokens`: `user_id` (primary key, so one row per user, and deleted with the user), `email`, `token_hash` (unique), `expires_at`, `created_at`. Asking again replaces the row. `email` is the address the link was issued for: confirming only counts while it is still the user's address, and the same row can carry a pending change of address (see "Changing the address"), so no second table is needed. Expired rows stay until replaced or until the user is deleted; there is at most one per user, so no cleanup job.
- The token is `generateToken()` (the generator behind session ids); only its SHA-256 is stored, so a leaked table gives nobody a working link. Time to live: `EMAIL_VERIFICATION_TTL_MS`, default 24 hours.

Flow:

1. `POST /account/signup` creates the user as it does now (same `201` and body, `email_verified_at` null) and, after responding, sends the verification email. Signup does not log in.
2. The mail links to `EMAIL_VERIFICATION_URL` (the frontend page, `http://localhost:5173/verify-email` in development) with the token as a URL fragment, `...#token=...`. A fragment is never sent to a server, so the token stays out of access logs and `Referer` headers. The page reads it and sends it to the API as a `POST`, not as a link straight to a `GET` endpoint, because mail scanners and link previewers open links on their own and would use up the token before the user does.
3. `POST /account/email/verify`, no session needed (the token is the credential). Body `{ token }`, a non-empty string (`400` otherwise). In one transaction: `DELETE FROM email_verification_tokens WHERE token_hash = $1 AND expires_at > now() RETURNING user_id, email`, then `UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()) WHERE id = $user_id AND email = $email`. Only one of two simultaneous requests can delete the row, so a link works once. If either step finds no row, the answer is `400 { "error": "This verification link is invalid or has expired" }`, the same for an unknown, used or expired token and for a link issued for an address the user no longer has. Success is `204`. Rate limited per IP, 10 per 15 minutes.
4. `POST /account/email/verification`, signed in: sends a new link to the account's current address and replaces the old one. `409 { "error": "Email is already verified" }` when it is; `429 { "error": "Please wait a minute before asking for another email" }` while the stored token is younger than 60 seconds; a per-user limiter of 5 per hour; `204` otherwise. The caller is signed in, so there is nothing to hide and the answers can be explicit. This is the "resend" button, and how existing accounts verify.
5. The user shape (login, `GET /account/me`, `PATCH /account/me`) gains `emailVerified: boolean`, so the frontend can show a "verify your email" banner. The timestamp itself is not sent. `userSelect`, `findSessionUser` and login's body change, and the tests that compare a whole user object get the new key.

What verification gates (to decide):

- Required: password reset sends only to verified addresses (see "Password reset (planned)").
- Not gated: login, chat and friends. Blocking login until verified would lock out someone who mistyped the address, who can never receive the link and has no way yet to change the address.
- Optional later: a `requireVerifiedEmail` middleware on the actions spammers want (for example `POST /friend/requests` and `POST /chat`), so throwaway accounts are less useful. Best added once the frontend can prompt for verification.

Changing the address (optional, but it is the way out of a typo): `POST /account/email`, signed in, body `{ email, password }` (the password like `DELETE /account/me` asks for it; the email follows signup's rules; `409` when it belongs to another account). It writes a token row whose `email` is the new address, replacing any pending one, and sends the link to the new address only. Confirming through `POST /account/email/verify` then sets the user's `email` from the row and `email_verified_at` in one transaction (a unique violation there is `409 { "error": "Email already in use" }`), and the old address gets a "your email was changed" mail. Until then the old address stays the login.

Known limit: signup answers `409` for a registered address even when it was never verified, so someone can register an address they do not own and keep its real owner out. If that matters, a signup for an address held by an unverified account older than some number of days could take the account over. Out of scope here.

Account deletion needs no change: the token row is deleted with the user (covered by `emailVerificationToken.schema.test.ts`).

Tests, once built (with the in-memory outbox): signup sends exactly one mail with a working link; verifying sets the timestamp and works once, not after it expires, not after a newer link replaced it and not when the user's address has changed; resend answers `409` when verified and `429` inside the cooldown, and replaces the old link; the limiters; `emailVerified` in the three user bodies; a table of bad bodies in the validator's unit test; for the address change, the pending row, the `409`s and the mail to the old address.

Build order: mailer, settings and outbox helper (shared with password reset); verification service and validator; controller, routes and limiters, the signup hook and `emailVerified` in the user shape; tests; this document and the README. The two frontend pieces (the banner with a resend button, and the page that reads the fragment and posts it) belong to the frontend milestone.

### Password reset (planned)

A signed-out user who forgot their password asks for a link by email, opens it, and sets a new password. The plan is two endpoints and one table, on top of the mailer from "Email delivery (planned)" and the verified addresses from "Email verification (planned)". Nothing here is implemented yet.

Decisions:

- **Only verified addresses get a reset link.** A reset link takes over the account, so it goes only to accounts with `email_verified_at` set. For an unverified account, `reset-request` sends the verification email instead (under the verification cooldown) and gives the same `202`, so someone who never verified is not locked out: they verify, then ask again. This makes email verification a prerequisite, so build it first.
- **Where the link points.** `PASSWORD_RESET_URL` is the frontend page (`http://localhost:5173/reset-password` in development) and the token is appended as a URL fragment, `...#token=...`, for the reasons given under email verification. The frontend does not exist yet, so until it does the endpoints are exercised with the token from the logged mail.
- **Email matching is exact**, like login (`findUnique({ where: { email } })`, and signup does not lowercase). Asking for `john@x.com` when the account was created as `John@x.com` sends nothing. Normalizing the case at signup and login is a separate fix, with a migration for the addresses already stored.

Schema: one new model, `PasswordResetToken`, shaped like `EmailVerificationToken` without the `email` column: `userId` (primary key, cascade on delete), `tokenHash` (unique), `expiresAt` and `createdAt`. An account has at most one outstanding link: asking again replaces it, so the table never grows past one row per user and needs no cleanup job.

- the token is `generateToken()` and only its SHA-256 is stored. Time to live: `PASSWORD_RESET_TTL_MS`, default 30 minutes. New setting: `PASSWORD_RESET_URL`
- services never send mail themselves: they return what is needed and the controller sends it after responding

`POST /account/password/reset-request` (signed out)

- incoming body: `{ email }`, a string accepted by `validator.isEmail`, otherwise `400`
- answers `202 { "message": "If an account exists for that email, a reset link is on its way" }` for every well-formed email, whether or not an account has it, so this endpoint cannot be used to find out who is registered. (Signup still answers `409` for a registered email, so registration is not hidden as long as that stays.)
- for a known, verified email: store a new token in place of the old one (an upsert on `userId`), respond, and only then send the mail
- if the account's token was created less than 60 seconds ago, nothing is stored or sent and the answer is the same `202`: it stops anyone from filling a victim's inbox or from replacing their link over and over
- two limiters in `accountRateLimit.middleware.ts`, both answering `429 { "error": ... }`: per IP (10 per 15 minutes) and per email (3 per hour, keyed on the lower-cased email from the body, and on the IP when there is none). Both count every request, known email or not, so a `429` reveals nothing either

`POST /account/password/reset` (signed out)

- incoming body: `{ token, new_password }`, both non-empty strings. `new_password` follows the signup rules (`validatePassword`) and is checked first, so a weak password is a `400` that does not use up the link
- claims the token and changes the password in one transaction: `DELETE FROM password_reset_tokens WHERE token_hash = $1 AND expires_at > now() RETURNING user_id`, then store the new hash and delete all of the user's sessions (expired ones too). Only one of two simultaneous requests with the same token can delete the row, so a link works once, and a failure rolls everything back, so the link survives it
- `400 { "error": "This reset link is invalid or has expired" }` for an unknown, used or expired token, one message for all three
- responds `204` and does not sign the user in: they log in with the new password, so `loginLimiter` stays in the path. Afterwards a "your password was changed" mail goes to the account's address, so a takeover does not go unnoticed
- rate limited per IP (10 per 15 minutes)

Changes to existing code: `changePassword` also deletes the account's reset token in its transaction (a link asked for earlier must not outlive a deliberate password change). `deleteAccount` needs nothing, the token goes with the user.

Tests, once built (with the in-memory outbox): both endpoints answer the same for a known and an unknown email and only a verified one gets exactly one reset mail; an unverified account gets the verification mail instead; the mailed token works once, not twice (including two requests at the same moment, called on the service), not after it expires and not after a newer one replaced it; a weak password is a `400` and the token still works afterwards; a reset signs out every session and the new password logs in while the old one does not; `changePassword` kills an outstanding token; the cooldown and the limiters; a table of bad bodies in the validators' unit tests.

Build order: email delivery; email verification; then the reset schema and migration, service and validators, controller, routes and limiters, tests, and this document and the README. The two frontend pages (a form that asks for the email and shows the `202` message, and a page that reads the fragment, asks for the new password and sends the user to the login) belong to the frontend milestone. Out of scope: reset by SMS through `tel`, security questions, locking an account after failed logins.

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
    │   │   ├── randomToken.ts       // generateToken: 32 random bytes as base64url (session ids now; emailed tokens later)
    │   │   ├── parseIdParam.ts      // numeric URL param -> ID or null (used by the chat and friend validators)
    │   │   ├── passwordHash.ts
    │   │   ├── prisma.ts
    │   │   └── validation.ts        // isValidHttpUrl, isRecord (used by the chat and account validators)
    │   ├── middlewares/             // shared by several features
    │   │   ├── ErrorHandler.ts      // every error body is { error }; keeps the status of 4xx errors Express raises
    │   │   ├── SessionCookie.ts     // set/clear/read the session cookie
    │   │   └── UserSessionAuth.ts   // requireUserAuth
    │   └── modules/
    │       ├── account/
    │       │   ├── account.routes.ts
    │       │   ├── accountRateLimit.middleware.ts   // loginLimiter (per IP), passwordCheckLimiter (per user; POST /account/password and DELETE /account/me share it)
    │       │   ├── account.controller.ts
    │       │   ├── account.service.ts
    │       │   ├── session.service.ts   // session database operations
    │       │   ├── login.validator.ts
    │       │   ├── deleteAccount.validator.ts   // DELETE /account/me body
    │       │   ├── password.validator.ts   // POST /account/password body
    │       │   ├── profile.validator.ts    // PATCH /account/me body
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
        │   ├── users.ts                      // createUser, loginAs (session cookie without going through /account/login), createSessionRow
        │   ├── chatRooms.ts                  // createGroupRoom, createDirectRoom, promoteToAdmin, memberIdsOf
        │   └── friends.ts                    // makeFriends, createFriendRequest (optional createdAt)
        ├── account/
        │   ├── session.test.ts               // login, me, logout
        │   ├── signup.test.ts                // includes the canonical-number and duplicate-spelling cases
        │   ├── profile.test.ts               // PATCH /account/me
        │   ├── password.test.ts              // POST /account/password, and changePassword's stale-hash guard
        │   ├── emailVerificationToken.schema.test.ts   // the hand-written migration's rules: one token per user, unique hash, deleted with the user
        │   ├── deleteAccount.test.ts         // DELETE /account/me, and deleteAccount's stale-hash guard and room lock
        │   ├── profile.validator.unit.test.ts
        │   ├── deleteAccount.validator.unit.test.ts
        │   └── password.validator.unit.test.ts
        ├── lib/                              // mirrors src/lib/
        │   └── randomToken.unit.test.ts
        ├── middlewares/                      // mirrors src/middlewares/
        │   ├── errorHandler.unit.test.ts     // the handler alone, with a fake response
        │   └── errorHandler.test.ts          // errors Express raises itself (malformed JSON, bad percent-encoding)
        ├── chatrooms/
        │   ├── chatRoom.test.ts              // create, list, get, update and delete a room
        │   ├── chatRoom.permissions.test.ts  // sign-in, membership, group-only and admin-only guards, per route
        │   ├── chatRoomMembers.list.test.ts
        │   ├── chatRoomMembers.add.test.ts
        │   ├── chatRoomMembers.remove.test.ts
        │   ├── chatRoomMembers.role.test.ts
        │   ├── chatRoomMessages.send.test.ts
        │   ├── chatRoomMessages.get.test.ts
        │   ├── chatRoomMessages.edit.test.ts
        │   ├── chatRoomMessages.delete.test.ts
        │   ├── chatRoomRead.test.ts
        │   ├── chatRoom.validator.unit.test.ts
        │   ├── chatRoomCleanup.service.test.ts
        │   └── chatRoomCleanup.job.unit.test.ts
        └── friends/
            ├── friendSearch.test.ts          // GET /friend/search/:tel
            ├── friendRequests.send.test.ts   // POST /friend/requests
            ├── friendRequests.get.test.ts    // GET /friend/requests
            ├── friendRequests.accept.test.ts // POST /friend/requests/:id/accept
            ├── friendRequests.delete.test.ts // DELETE /friend/requests/:id
            ├── friends.list.test.ts          // GET /friend
            ├── friends.remove.test.ts        // DELETE /friend/:id
            ├── friend.permissions.test.ts    // sign-in guard, per route
            └── friend.validator.unit.test.ts
```

Conventions:

- File names follow `<subject>.<role>.ts`, for example `chatRoom.service.ts` or `login.validator.ts`.
- A new feature gets its own folder under `src/modules/` with its routes, controller, validator(s) and service(s); its router is mounted in `app.ts`.
- All database operations are kept in the `*.service.ts` files and go through the shared Prisma client from `src/lib/prisma.ts`. There is no separate repositories layer, so a transaction (room creation, member removal) stays inside one service function.
- A fixed technical limit shared by more than one module (for example the Postgres INTEGER max, reused as both an ID ceiling and a `setInterval`/`setTimeout` delay ceiling) is declared once in `src/lib/constants.ts` and imported everywhere it's needed, instead of being redeclared per file.
- Services never import Express (no `req`, `res` or cookies). HTTP concerns live in controllers and middleware, so other entry points, such as the future Socket.io handlers, can call the same services.
- Middleware used by a single feature lives in that feature's folder (for example `chatRoomAuth.middleware.ts`, `accountRateLimit.middleware.ts`, `friendRateLimit.middleware.ts`); `src/middlewares/` only holds middleware shared across features. Rate limiters follow the same rule: each feature keeps its own limiters, keyed by IP where nobody is signed in yet (`loginLimiter`) and by user id after `requireUserAuth` (`friendSearchLimiter`, `passwordCheckLimiter`).
- Error bodies: every `4xx` and `5xx` response has the shape `{ "error": "<text>" }`, whichever layer sends it (controller, feature middleware, rate limiter, `errorHandler`). `message` is not used for errors because it is already a success-body key for a chat message (`POST` and `PATCH /chat/:chatid/message` return `{ "message": { ... } }`), so a client could otherwise get a string and an object under the same key from one endpoint. Validators keep their own internal `{ valid: false, message }` result; the controller puts that text under `error`. A success body that only confirms an action (`201 { "message": "Account created successfully" }` from signup) is not an error body and is unchanged.
- Session handling is split in two: `modules/account/session.service.ts` talks to the database, and `middlewares/SessionCookie.ts` reads, sets and clears the cookie.
- Background jobs live in the folder of the feature they belong to and are started from `server.ts`, never from `app.ts`, so tests that import the app do not start timers.
- Tests live in `server/test/`, in a folder per feature that mirrors `src/modules/` (`test/account/`, `test/chatrooms/`, `test/friends/`; `test/middlewares/` mirrors `src/middlewares/` and `test/lib/` mirrors `src/lib/`), and import from `../../src/...`. Shared fixtures live in `test/helpers/`. `loginAs(user)` creates the session row and sends its cookie directly, so no test outside `test/account/` depends on `/account/login` or its rate limiter.
- Each test file covers what its part of the code owns: an endpoint file covers that endpoint's business rules plus one bad-input case to prove the validator is wired in; the full list of bad inputs is a table in `chatRoom.validator.unit.test.ts` (no database); `chatRoom.permissions.test.ts` covers the shared guards once per route, so a new route should be added to its lists. Keep a new test only if it guards a rule that is not already covered by another one.
- `npm run build` runs `tsc` and then `scripts/fix-esm-imports.mjs`. The source keeps extensionless imports, but Node's ESM loader needs real file names, so the script rewrites the relative imports in `dist/` (`./app` becomes `./app.js`, a folder import becomes `./dir/index.js`) and fails the build if an import points at nothing. `npm start` runs `node dist/server.js`.

## Empty chat room cleanup

A room whose last member has left is not deleted on the spot. `DELETE /chat/:chatid/member/:userid` stamps the room's `emptied_at` column in the same transaction as the removal (`DELETE /account/me` does the same for a room whose only member was the deleted user), and a job running inside the API process deletes the room once it has stayed empty for the retention period. Deleting the room cascades to its messages.
The job is `modules/chatrooms/chatRoomCleanup.job.ts` (timer, validation of the two settings below) and the database work is `chatRoomCleanup.service.ts` (`purgeExpiredEmptyChatRooms`).

- `EMPTY_ROOM_RETENTION_MS`: how long a room stays empty before it is deleted (default 7 days)
- `EMPTY_ROOM_CLEANUP_INTERVAL_MS`: how often the job looks for expired rooms (default 1 hour); it also sweeps once when the server starts
- each sweep first stamps any empty room that has no `emptied_at` yet (a safety net: the two endpoints above already stamp the room themselves), so its retention clock starts then, and then deletes rooms whose stamp is older than the retention period
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
- Login verifies the password, then `createSession` (`session.service.ts`) deletes the user's expired sessions and stores a new one (with a random 256-bit id from `generateToken`), and `setSessionCookie` (`middlewares/SessionCookie.ts`) sends the session cookie in the response.
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
- Account services create and find users, update a profile, change a password (`changePassword` also deletes the other sessions in the same transaction) and delete an account (`deleteAccount` locks the rooms the user is in, refuses while the user is the only admin of a group room that still has other members, and leaves the rest to the foreign keys). The session service creates, reads, and deletes sessions (rows only; cookies are handled in `middlewares/SessionCookie.ts`).
- Chat-room services check with `findNonFriendIds` (from the friend service) that everyone being added is a friend of the requester, create rooms and memberships in a Prisma transaction, load direct and group rooms, retrieve the latest message for room summaries, and update or delete rooms.
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

1. Close the REST gaps listed under "Proposed additional endpoints" (unread counts on room summaries)
2. Implement real-time communication with Socket.io (see "Real-time events")
3. Build the React frontend and integrate with TanStack Query
4. Add authentication-aware UI states and protected routes
5. Add deployment configuration and production hardening, including email delivery, email verification and the password reset flow (see "Email delivery (planned)", "Email verification (planned)" and "Password reset (planned)")

## Notes

This document reflects the current state of the repository. The auth module and the core chat-room backend are in place and working;
the remaining messaging feature set is planned as incremental extension work for the app.
