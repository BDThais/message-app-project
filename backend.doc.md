# Message App Project Planning & Progress

## Overview

This project is a real-time messaging application built with PostgreSQL, Prisma, TypeScript, Express.js, and a React frontend.
The backend has grown beyond the original account/session MVP and now includes a working chat-room foundation with direct and group room support, while the realtime features are still planned work.

The project has three documents: `./api.doc.md` specifies the API (what a client sends and gets back), this one is the server's plan and how it is built, and `./frontend.doc.md` is the frontend's plan.

## Tech Stack

- PostgreSQL
- Prisma ORM
- TypeScript
- Express.js
- React
- TanStack Query
- Socket.io
- TanStack Router
- Vite (frontend dev server and build)
- Argon2 (password hashing), cookie-parser, express-rate-limit
- Resend (email delivery, behind the `Mailer` interface in `src/lib/mailer.ts`)
- Vitest + Supertest (server tests), Docker Compose (test database)
- Vitest + Testing Library + jsdom (frontend tests; see `./frontend.doc.md`)

## Test database setup

Backend tests are integration tests (Vitest + Supertest) that run against a separate PostgreSQL database provided by
`server/docker-compose.test.yml` (`chatapp_test`, port 55432). Copy `server/.env.test.example` to
`server/.env.test` once, then run `npm test` from `server/`. The test command
starts the container, deploys the existing Prisma migrations, and runs Vitest.
`test/setup.ts` refuses to run unless `NODE_ENV=test` and the database is `chatapp_test`, and it empties every table
before each test. It also empties the counts of every rate limiter before each test (`resetRateLimiters` in `src/lib/rateLimiter.ts`), so every test starts with full budgets and none of them has to count requests, and it installs the in-memory mail outbox (`test/helpers/mailer.ts`) as the app's mailer and empties it before each test, so no test sends or logs a mail. It keeps the one bot user (`is_bot`) that the migration `add_private_chat_room` creates, and deletes every other user (see "Private chat room (implemented)"). Every test connection also runs in the `Asia/Ho_Chi_Minh` time zone (UTC+7), set through `PGOPTIONS` in `setup.ts` whatever the database server's own setting is: the `timestamp` columns hold UTC, so code that compares one with the database's `now()` is off by seven hours there and its test fails, instead of the bug showing up only on a server whose time zone is not UTC (`test/lib/testTimeZone.test.ts` guards this). It does not use the development database configured in `server/.env`.

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

- POST /api/account/signup
- POST /api/account/login
- GET /api/account/me
- POST /api/account/logout
- PATCH /api/account/me
- POST /api/account/password
- DELETE /api/account/me
- POST /api/account/email/verify
- POST /api/account/email/verification
- POST /api/account/password/reset-request
- POST /api/account/password/reset
- POST /api/chat
- GET /api/chat
- GET /api/chat/:chatid
- PATCH /api/chat/:chatid
- DELETE /api/chat/:chatid
- GET /api/chat/:chatid/member
- POST /api/chat/:chatid/member
- DELETE /api/chat/:chatid/member/:userid
- PATCH /api/chat/:chatid/member/:userid
- POST /api/chat/:chatid/message
- GET /api/chat/:chatid/message
- PATCH /api/chat/:chatid/message/:message_id
- DELETE /api/chat/:chatid/message/:message_id
- PUT /api/chat/:chatid/read
- GET /api/friend/search/:tel
- POST /api/friend/requests
- GET /api/friend/requests
- POST /api/friend/requests/:id/accept
- DELETE /api/friend/requests/:id
- GET /api/friend
- DELETE /api/friend/:id
- Chat membership validation and admin/role enforcement
- Direct-room reuse and group-room creation flows
- Friendship requirement for creating a room and adding members (see "Friendship and messaging")
- Room summaries with the latest message that has not been deleted and the requester's unread count
- Automatic cleanup of chat rooms that stay empty (see "Empty chat room cleanup")
- Email delivery: the `Mailer` in `src/lib/mailer.ts` with a console transport and a Resend transport, chosen by `MAIL_TRANSPORT` and checked when the server starts (see "Email delivery").
- Email verification (see "Email verification (implemented)"): a link is mailed at signup and on request, `POST /api/account/email/verify` uses it, and the user shape carries `emailVerified`. It is the first feature that sends mail
- Password reset (see "Password reset (implemented)"): a signed-out user asks for a link by email (`POST /api/account/password/reset-request`), opens it, and sets a new password (`POST /api/account/password/reset`). Only verified addresses get a link. It is the second feature that sends mail
- Private chat room (see "Private chat room (implemented)"): every account has a direct room with a hidden bot account, like "My Documents" in Zalo. It is created with the account, and the migration gave the existing accounts theirs
- Email addresses are not case-sensitive: they are stored lower-cased (`src/lib/emailAddress.ts`, and a CHECK constraint on `users.email`), so signup, login and password reset treat `John@x.com` and `john@x.com` as one account
- Integration tests for the account endpoints (including profile update, password change, account deletion, email verification and password reset), the chat-room endpoints (including the `lastMessage` and `unreadCount` of the room summaries), the empty-room cleanup, the friend search endpoint, the send-friend-request endpoint, the list-friend-requests endpoint, the accept-friend-request endpoint, the reject/cancel-friend-request endpoint, the list-friends endpoint, the unfriend endpoint and the friendship requirement for creating rooms and adding members
- Integration tests for the private chat room and for the migration's backfill (`privateRoom.test.ts`, `privateRoom.backfill.test.ts`)
- Unit tests for the mailer (the startup checks of the mail settings, the console transport, and the Resend transport run through the real Resend SDK with a stubbed `fetch`), and a test that guards the mail outbox wiring of the test setup
- Unit tests for email verification (the settings checks, the link and the send helper, the body validator), for `hashToken`, and for how `EMAIL_VERIFICATION_TTL_MS` is read
- Unit tests for the password reset (the settings checks, the two mails and their send helpers, the two body validators), for the key of the per-email limiter, and for how `PASSWORD_RESET_TTL_MS` is read
- Frontend scaffold (step 1 of `./frontend.doc.md`): Vite + React + TypeScript in `frontend/`, a dev proxy that forwards `/api` to this server, the fetch wrapper and query client, TanStack Router with the signed-in/signed-out route guards (they use `GET /api/account/me`), a thin login page, and tests for all of it
- Every route is served under the `/api` prefix: `app.ts` mounts the routers at `/api/account`, `/api/chat` and `/api/friend`, the frontend's dev proxy forwards `/api` unchanged (it used to strip the prefix), and the integration tests call the prefixed paths
- Routes nothing serves answer `404 { "error": "Route not found" }` through `notFoundHandler` (in `middlewares/ErrorHandler.ts`, registered in `app.ts` after the routers and before `errorHandler`), so Express's own HTML 404 page no longer breaks the rule that every error body is `{ error }`
- The API contract (`src/contract/`, see "API contract" in Conventions): the entity shapes of `api.doc.md` as TypeScript, every endpoint's request, response and error bodies, `bodyFields` for reading a request body through them, and the controllers and validators of the account, chat room and friends modules written against them (the chat room and friends ones through their serializers). The account module's own user type is the contract's `User` (it was `PublicUser` in `account.service.ts`, a second type of that name next to the friends module's, which is now the contract's `PublicUser`), and `toPublicUser` is `toUser`.

Still planned or not yet implemented:

- Changing the email address (optional, see "Changing the address" under "Email verification (implemented)")
- Real-time socket communication
- Frontend application screens and state management (the scaffold exists; the steps still to do are in `./frontend.doc.md`)
- Production deployment hardening

The room and auth systems are now acting as the current working backend foundation. The friend endpoints are all in place, so the frontend is the next milestone, with realtime (built together with the frontend's step 6) after it; both remain future work rather than a missing piece of the current baseline.

Note: In the database, the mutual friendship model stores two rows per friendship pair, one for each user, as described in the project requirements.

## API implementation notes

The specification of every endpoint (request and response bodies, status codes, error texts, rate limits, the permission model) is in `./api.doc.md`, and it is the source of truth for what a client sees. This section is how the endpoints are built and why: the files, the transactions and locks, the limiters, and the decisions behind a behavior. When an endpoint's request, response, status code or error body changes, change `./api.doc.md` in the same patch; a change that only touches the how stays here.

All of the endpoints below are routed after the auth middleware, so they can reach the current user through `req.user`; an endpoint that needs a session has to be routed after it.
`req.user` shape = {
  id: number;
  name: string;
  email: string;
  tel: string;
  avatarUrl: string | null;
  emailVerified: boolean;
}

### Account endpoints

POST /api/account/signup

- Validation is `validateAccountBody` in `signup.validator.ts`: it checks that all four fields are non-empty strings (a number, an array, a body that is not an object, or no JSON body at all counts as missing, like at login), then name, email (`validateEmail` in `src/lib/emailAddress.ts`, a wrapper of `validator.isEmail` that the password reset uses too), tel and password in that order, and answers `{ valid: false, message }` with the first message that fails, or `{ valid: true, data }`, the shape of the other validators
- `avatar_url` is deliberately not a signup field: `users.avatar_url` is a nullable column with no default, so a new account always has `avatarUrl: null` and the user adds an avatar later through `PATCH /api/account/me`. Extra fields in the signup body are ignored
- Stores `email` lower-cased, as `normalizeEmail` in `src/lib/emailAddress.ts` writes it, for the reason `tel` is stored canonical: the unique index compares raw strings, so `John@x.com` and `john@x.com` would otherwise be two accounts, and login would only find the one that was typed the same way. `validator.isEmail` checks the format only and accepts every case, so it cannot do this; `validator.normalizeEmail` is not used because it also removes dots and `+tags` for some providers, which rewrites the address. The duplicate check, the insert and the verification mail all use the lower-cased address, so `JOHN@x.com` is `409 Email already exists` when `john@x.com` is registered (a race between two spellings ends in the same `409`, through the unique index). Nothing is trimmed
- Stores `tel` in its canonical E.164 spelling (`+` and digits only), not as typed: `isValidPhoneNumber` accepts spaces, dashes, parentheses, non-ASCII digits and extensions, and the unique constraint compares raw strings, so `+1 (415) 555-2671` and `+14155552671` would otherwise both register, and `GET /api/friend/search/:tel` (an exact match) could never find the first. `normalizeTel` in `signup.validator.ts` validates with `isValidPhoneNumber` (so the set of accepted numbers is unchanged) and then takes `parsePhoneNumberFromString(tel).number`; an extension is dropped. The duplicate check and the insert both use the normalized number, so another spelling of a registered number answers `409`
- Numbers stored before this change are rewritten by `npm run db:normalize-tels` (`scripts/normalize-tels.mjs`, run from `server/` against the database in `DATABASE_URL`). It is a dry run that lists the changes; add `-- --apply` to write them, in one transaction. It never touches a number that is no longer valid or accounts that would end up with the same number: it lists them, exits with code `1`, and leaves the merge or delete to you
- Hashes the password before saving
- Creates the account's private chat room in the same transaction (see "Private chat room (implemented)"): the signup answers `500` and creates nothing if the bot that is the room's other member is missing
- Mails a verification link to the new address after responding (see "Email verification (implemented)"): the account starts unverified, and a mail that cannot be sent does not fail the signup (it is logged, and the user asks again with `POST /api/account/email/verification`)
- the duplicate check and the insert are two statements, so two simultaneous signups for the same email or number can both pass the check. The database then refuses the second insert (a unique violation, Prisma `P2002`) and the answer is the same `409`, naming the column that really collided: `Email already exists` or `Phone number already exists`. Where Prisma reports that column depends on its setup: with the `PrismaPg` driver adapter this project uses, `meta.target` is absent and the column is in `meta.driverAdapterError.cause.constraint` (`fields`, or `index` for the constraint's name), so a handler that only reads `meta.target` never finds it (the old one answered `Phone number already exists` whatever the cause). `uniqueViolationMessage` in `signup.validator.ts` reads both places, and says `Email or phone number already exists` when the error names neither

POST /api/account/login

- Returns the same generic message for an unknown email and for a wrong password (the lookup answers `null` for both)
- Deletes any expired session already stored for the same user
- Creates a new session and sets the session cookie. The session id is 32 random bytes from `crypto.randomBytes`, base64url-encoded (43 characters), made by `generateToken` (`src/lib/randomToken.ts`) in `createSession`; `sessions.id` has no default in the schema, so a session cannot be created without one. Sessions created before this change keep their old ids and work until they expire; to sign everybody out at once, run `DELETE FROM sessions;`
- The limiter is `loginLimiter`, in `modules/account/accountRateLimit.middleware.ts`
- The body is read with `bodyFields<LoginBody>` (the same helper the validators use), so a request with no JSON body at all counts as a missing field and answers `400`, like a body without the two fields. (Until the contract was added the controller destructured `req.body` directly, and that request answered `500`.)

GET /api/account/me

- `avatarUrl` is part of the user shape everywhere: `findSessionUser` selects it, so `GET /api/account/me` and `req.user` carry it, and login returns it. `emailVerified` is part of the user shape everywhere too (login, `GET /api/account/me`, `PATCH /api/account/me`, `req.user`): it is `true` once the address is verified, and the timestamp itself (`email_verified_at`) is never sent. `toPublicUser` (`account.service.ts`) builds the shape from `userSelect`, so the bodies cannot drift apart

POST /api/account/logout

- Invalidates the current session if it exists and clears the cookie

PATCH /api/account/me

- Validation lives in `profile.validator.ts`. The two checks that both it and the chat-room validators need (`isValidHttpUrl`, `isRecord`) live in `src/lib/validation.ts`. The service is `updateUserProfile` (`account.service.ts`)

POST /api/account/password

- Validation lives in `password.validator.ts`
- `changePassword` (`account.service.ts`) only writes when the stored hash is still the one that was verified, so a stale "current password" cannot overwrite a newer one: if the password was changed by another request between the check and the write, the answer is the same `401 Current password is incorrect`
- in one transaction, stores the new hash and deletes all the user's other sessions (expired ones too), so a leaked session stops working; other users' sessions are untouched. It also deletes the account's password reset token, so a link asked for earlier cannot outlive a deliberate password change
- rate limited because otherwise a stolen session cookie could guess the password here without the limit login has. `passwordCheckLimiter` lives in `modules/account/accountRateLimit.middleware.ts`, is keyed by user id, and so is mounted after `requireUserAuth`. Every request that gets past `requireUserAuth` counts, including ones answered with a `400`. `DELETE /api/account/me` uses the same limiter instance, so the two routes share one budget

DELETE /api/account/me

- Validation lives in `deleteAccount.validator.ts`. The password is asked for the same reason `POST /api/account/password` asks for the current one: deleting is irreversible, so a session cookie alone (a stolen one, or a browser left signed in) must not be enough
- `deleteAccount` (`account.service.ts`) only deletes when the stored hash is still the one that was verified, like `changePassword`, and answers the same `401` otherwise
- the `409` is the only-admin rule of `DELETE /api/chat/:chatid/member/:userid`, applied to the whole account, so a room with members always keeps an admin. Nothing is deleted, not even the rooms where the requester is only a member
- everything runs in one transaction. The foreign keys delete the user's sessions (all of them, expired ones too), room memberships, friend-list entries (in both directions) and friend requests (sent and received). The user's messages stay in their rooms with `senderId` and `sender` set to `null`, so the other members keep the conversation; nobody can edit or delete such a message afterwards, because both are sender-only. A direct room stays with its remaining member, who still lists and reads it. The account's private room is the exception: it is deleted with its messages (see "Private chat room (implemented)")
- a room whose only member was the requester gets `emptied_at` in the same transaction, so the retention clock of the cleanup job starts right away (see "Empty chat room cleanup")
- every room the requester is in is locked (`SELECT ... FOR UPDATE`, in id order so two deletions that share rooms cannot deadlock) before the admin check, for the same reason as on `DELETE /api/chat/:chatid/member/:userid`: two admins of one room deleting their accounts at the same moment could otherwise both pass the check and leave the room with members but no admin
- the limiter is the one `POST /api/account/password` uses (`passwordCheckLimiter`)

POST /api/account/email/verify

- No session is needed because the token is the credential, and the link is often opened on another device than the one that is signed in. Validation lives in `emailVerification.validator.ts`
- One message for every kind of bad token, so the answer says nothing about which it was. A link works once, even for two simultaneous requests
- The limiter is `emailVerifyLimiter` (`modules/account/accountRateLimit.middleware.ts`); every request counts, including ones answered with a `400`
- how links are made, stored and mailed is under "Email verification (implemented)"

POST /api/account/email/verification

- This is the "resend" button, and how accounts created before email verification verify. The mail goes out after the response
- `emailVerificationRequestLimiter` is keyed by user id, so it is mounted after `requireUserAuth`; every request that gets past it counts, including ones answered with a `409` or the cooldown's `429`. The cooldown itself is not a limiter: it is the age of the stored link (see "Email verification (implemented)")

POST /api/account/password/reset-request

- No session is needed: whoever asks has forgotten the password. Validation lives in `passwordReset.validator.ts`
- answers `202` for every well-formed email, whether or not an account has it, and whatever else happens below, so the answer cannot be used to find out who is registered. (Signup still answers `409` for a registered email, so registration is not hidden as long as that stays.)
- the database work is finished before the answer and the mail goes out after it (a failed or slow mail changes nothing for the caller)
- two limiters, in this order: per IP and per email. Every request counts, known email or not and valid body or not, so a `429` reveals nothing either. The per-email key is the address from the body in its canonical form (`normalizeEmail`, the function the lookup uses), or the client's IP when the body has no usable address (not a string, or longer than 254 characters); keys have an `email:` or `ip:` prefix, so an address that looks like an IP cannot use up that IP's budget. The limiters live in `modules/account/accountRateLimit.middleware.ts`
- how links are made, stored and mailed is under "Password reset (implemented)"

POST /api/account/password/reset

- No session is needed: the token is the credential, and the link is often opened on another device. Validation lives in `passwordReset.validator.ts`; the password rules are checked first, so a weak password does not use up the link
- One message for every kind of bad token. A link works once, even for two simultaneous requests; every session of the account is deleted (expired ones too); the "your password was changed" mail goes out after the response
- The limiter is `passwordResetLimiter` (`modules/account/accountRateLimit.middleware.ts`); every request counts, including ones answered with a `400`

### Room, message and friend endpoints

Roles are enforced by `loadChatMembership` (the membership check every `/api/chat/:chatid` route starts with, `404` for a non-member), `requireGroupRoom` and `requireChatAdmin`, all in `chatRoomAuth.middleware.ts`; the permission table is in `./api.doc.md`. A direct room has no name/avatar to edit, its members cannot add or remove the other member from the room, and all of its members are admins.

POST /api/chat

- Validation is `validateCreateChatRoomInput` in `chatRoom.validator.ts`; the group name limit is `MAX_CHAT_NAME_LENGTH`, shared with `validateUpdateChatRoomBody` so create and rename cannot drift apart, and `avatar_url` goes through `isValidHttpUrl` like on `PATCH /api/chat/:chatid`
- `createChatRoom` (`chatRoom.service.ts`) runs in one transaction and checks the friendships (`findNonFriendIds`, see "Friendship and messaging") before anything is written, so a refused request creates no room and no members. For a direct room the check also comes before the lookup of an existing room
- a direct room is reused with a `findFirst` for a direct room that has both users as members, so hitting "message" on a friend never creates a duplicate; the requester and the other user are both added as admins
- a group room: the requester is added as admin and the invitees as members, with the same default role `POST /api/chat/:chatid/member` uses
- the response is `{ "chatRoom": CreatedChatRoom }`: the room as its creator sees it (`getChatRoomSummaryForUser`, the same summary as `GET /api/chat/:chatid`, plus their `role`) with its `members` added, so a direct room carries the other member's name and a reused one its real `lastMessage` and `unreadCount`. The summary is read after the room is created or found, and a room that is gone by then answers `404 Chat room not found`. `emptiedAt` is left out of the stored room's query (`omit` in `roomWithMembersArgs`, `chatRoom.service.ts`) and the serializer names every field; `chatRoom.test.ts` pins the exact set of keys so a new column cannot leak in unnoticed
- each entry of `members` is built from `memberResponseArgs` (`chatMember.service.ts`), the shape every member payload shares: the user is only under `member`, there is no separate `memberId`, it would repeat `member.id`

GET /api/chat

- there are separate functions for retrieving direct and group rooms; both return the rooms that have `req.user` as a member, and the one for direct rooms uses the other user's name as the room's name and their avatar url (when it is not null) as the room's avatar url
- the `lastMessage` lookup skips deleted messages: a deleted message has no content left, so showing it would give the room list a blank preview. The order follows the message that is shown, which is why deleting the newest message moves the room down the list. It carries the message's `id` and `senderId` (both selected in `getDirectChatRoomsForUser` and `getGroupChatRoomsForUser`, named in `toChatRoomSummary`): without the id a client that edits or deletes a message cannot tell whether it was the room's last, and has to ask for the whole list again; without the sender it cannot show who wrote it
- the rooms' unread counts come from one query for the whole list (`countUnreadMessages`, raw SQL because the threshold is a column of each room's own membership row; the `(chat_id, id)` index serves it), not one per room. Only the requester's own marker matters
- a member added to a room that already has messages starts with a marker at the newest message, so the rule that their `unreadCount` is `0` is stored data, not a special case in the count (see `POST /api/chat/:chatid/member`)
- the rooms are sorted by how recent the last message is, and the rooms with no message by the time they were created

GET /api/chat/:chatid

- same summary function as `GET /api/chat` for one room (`getChatRoomSummaryForUser`, which `POST /api/chat` and `PATCH /api/chat/:chatid` use too), plus the requester's `role`
- the room can be gone by the time it is read (deleted, or the requester removed, after `loadChatMembership` ran): that answers `404 Chat room not found`, the answer a non-member gets, and not a `200` with only a `role`

PATCH /api/chat/:chatid

- guarded by `requireGroupRoom` and `requireChatAdmin`; validation is `validateUpdateChatRoomBody`; the response is `{ "chatRoom": ChatRoomDetail }`, the room read back after the update with `getChatRoomSummaryForUser` (so it is what `GET /api/chat/:chatid` would answer, and `404 Chat room not found` if the room was deleted in between)

DELETE /api/chat/:chatid

- guarded by `requireGroupRoom` and `requireChatAdmin`; the foreign keys cascade to the messages and memberships

GET /api/chat/:chatid/member

- no group-only or admin-only guard: membership alone is required. It is how the frontend shows who is in an existing room and builds the promote/remove screens; member lists otherwise only appear in the responses of room creation, add-members and change-role
- the sort is done in the service, so the order does not depend on the database's collation; members whose names compare equal keep user-ID order

POST /api/chat/:chatid/member

- guarded by `requireGroupRoom` and `requireChatAdmin`; new members are inserted with role `member`
- the marker for a new member is the room's newest message that has not been deleted. Everyone added by one request gets the same marker, and a user who left and is added again starts fresh, because leaving deleted their marker. The newest message is looked up just before the insert, not in the same statement, so a message sent in between stays unread for the new member, which is right because it was sent after they joined. A deleted message above that marker never counted as unread anyway
- users who are already members are skipped and left unchanged (so an existing admin is never demoted) and are not checked for friendship, so they are skipped even if they are no longer friends
- the friendship check is `findNonFriendIds` (see "Friendship and messaging"); it runs after validation and after the group-room and admin guards

DELETE /api/chat/:chatid/member/:userid

- `:userid` is validated like the other ids (`400 Invalid user id`)
- the only-admin rule: the target being the room's only remaining admin while other members are present is a `409`. It does not apply to a direct room, since both of its members are admins
- nobody can leave their private room (`403 You cannot leave your private chat room`, see "Private chat room (implemented)")
- this endpoint never deletes the ChatRoom record itself: when the last member leaves, no ChatMember record links to the room any more, and it stamps the room's `emptied_at` in the same transaction; the room (and its messages) is deleted later by the cleanup job (see "Empty chat room cleanup")
- the room row is locked (`SELECT ... FOR UPDATE`) while the removal runs, so two admins leaving at the same moment cannot both pass the only-admin check and leave a room with members but no admin

PATCH /api/chat/:chatid/member/:userid

- guarded by `requireGroupRoom` and `requireChatAdmin`; the `409` is the same only-admin invariant `DELETE /api/chat/:chatid/member/:userid` enforces on removal, applied to a demotion; it does not apply when the target is the room's only member

POST /api/chat/:chatid/message

- no group-only or admin-only guard: membership alone is required. Validation is `validateSendMessageBody`

GET /api/chat/:chatid/message

- no group-only or admin-only guard, same as sending. `before` and `limit` are validated the same way `:chatid` and `:userid` are (positive integer, within the Postgres integer range)

PATCH /api/chat/:chatid/message/:message_id

- membership alone gets a request to the controller; the sender check happens in the service, same as deleting. Validation is `validateEditMessageBody`, held to the same rules as sending
- a deleted message can never be edited back to life: the write itself is conditional on the message not being deleted, so an edit racing with a delete gets the same `404` as an edit sent after it

DELETE /api/chat/:chatid/message/:message_id

- a soft delete: the message row stays, but `content` is cleared and `deleted_at` is stamped, so it keeps its place in the room's history instead of leaving a gap in the id sequence. The sender check happens in the service. Deleting a message never deletes the underlying `ChatRoom` or affects other members' access to the room

PUT /api/chat/:chatid/read

- sets the requester's own `ChatMember.lastReadMessageId`, which every member payload returns; membership alone is required (no group-only or admin-only guard)
- the marker only moves forward with one conditional `updateMany` (`lastReadMessageId` is null or lower than the new value) rather than read-then-write, so requests racing each other end at the highest id. The marker is read afterwards only when the update changed nothing
- the marker the call answers with is a `number` in the contract. A null one after an update that skipped the row cannot happen (the update also matches a null marker, and messages are never hard-deleted apart from their whole room), so `markChatRoomRead` throws there instead of answering `lastReadMessageId: null`
- if the requester left the room while the request was running, it answers `404 { "error": "Chat room not found" }`, the same as the membership check

#### Friend endpoints

Friend flows get their own module, `src/modules/friends/` (routes, controller, validator(s), service), mounted in `app.ts` behind `requireUserAuth` like the chat routes. A user is always returned to other users as `{ id, name, avatarUrl }`, never with `email` or `tel`.

Schema changes for this milestone (done, in migration `20260928120000_add_friend_request_created_at_and_receiver_index`):

- `PendingFriendRequest.createdAt` (`DateTime @default(now())`), needed to sort the inbox and to expire stale requests later
- `@@index([receiverId])` on `PendingFriendRequest`: the existing `@@unique([senderId, receiverId])` index only serves lookups that start with the sender, and the inbox query filters by receiver

ID conventions: `/api/friend/:id` takes a *user* ID. Every `/api/friend/requests/:id` route takes a *request* ID (`PendingFriendRequest.id`), not the other user's ID. With a user ID, `DELETE /api/friend/requests/:id` would be ambiguous when two users have sent each other a request at the same moment (reject theirs, or cancel yours?).

GET /api/friend/search/:tel

- `:tel` is validated with the same libphonenumber-js rule signup uses, and must also be in canonical spelling. That rule alone (`isValidPhoneNumber`) also accepts `+1 (415) 555-2671` and `+14155552671x123`, and because the lookup is an exact string match, accepting them would answer "nobody found" for a number that is registered. It is a path parameter on purpose: `+` is kept as-is in a path, whereas in a query string `+` decodes to a space
- exact match only, so the endpoint can't be used to browse or list users. It still lets any signed-in user test whether a number is registered, which is inherent to phone lookup, so it is rate limited per user (every request past the sign-in check counts, `400`s included) and returns nothing beyond what the friend UI needs
- the two request states only coexist through the send-at-the-same-instant race described under `POST /api/friend/requests`, and `request_received` wins because accepting it clears both

POST /api/friend/requests

- an unknown `receiver_id` is a `400` here, unlike `POST /api/chat`, which answers `403` for an unknown user and a stranger alike
- rate limited per user to keep it from being used to spam; like search, every request past the sign-in check counts, `400`s and `409`s included
- a duplicate that slips past the checks (double click, two tabs) is caught by the unique constraint and answered with the same `409`
- known and accepted race: if two users send each other a request at the same instant, both can be stored (the unique constraint is per direction). This is harmless because accepting deletes the pair's requests in both directions (see below), so no hand-written database constraint is needed

GET /api/friend/requests

- `user` is selected down to `{ id, name, avatarUrl }` in the query itself, so `email` and `tel` are never read
- sorted by `createdAt` descending, with the request `id` descending as the tie-break, so requests with the same timestamp always come back in the same order
- no pagination and no rate limiter: it only lists requests that already involve the requester, so it reveals nothing about other users. Add `limit`/`before` in the style of `GET /api/chat/:chatid/message` if an inbox can grow large

POST /api/friend/requests/:id/accept

- in one transaction: create both `FriendListMember` rows (`createMany` with `skipDuplicates`, so it is safe to repeat and completes a friendship that only has one of its two rows), then delete every pending request between the two users in either direction
- the two rows are always created in the same order (lower user ID first), whoever accepts. Two users who sent each other a request at the same instant can also accept at the same instant, and if each transaction inserted its own side first, Postgres could abort one of them as a deadlock
- a double click or a second tab sending the same accept twice at once is answered with `201` and `201`, or `201` and `404`, never a `5xx`; either way there is one friendship and no request left. If the sender's account is deleted while the request is being accepted, the answer is the same `404`
- no rate limiter: it only works on a request addressed to the requester, so it reveals nothing about other users

DELETE /api/friend/requests/:id

- it deletes only the request `:id` names. When two users sent each other a request at the same instant, the other request of the pair stays: it is a different request (which is why `:id` is a request ID and not a user ID), and accepting it still clears the pair
- the permission check and the delete are one `deleteMany` statement narrowed to requests the requester is a party to, not a lookup followed by a delete. A double click or a second tab sending the same call twice at once, or the sender cancelling while the receiver rejects, is therefore answered with `204` and `404`, never a `5xx`; either way the request is gone
- no rate limiter: it only works on a request the requester is a party to, so it reveals nothing about other users
- only the request row goes: the other party is not notified and nothing else changes, so after a rejection or a cancellation either user can send a new request

GET /api/friend

- it reads the requester's *own* friend-list rows, the same rows `GET /api/friend/search/:tel`, `DELETE /api/friend/:id` and the friendship check of the chat-room endpoints read, so every endpoint agrees on who is a friend. A half-written friendship (only one of the two rows, which the API itself never produces) is therefore listed for the user whose row exists and not for the other
- each friend is selected down to `{ id, name, avatarUrl }` in the query itself, so `email` and `tel` are never read
- the sort is done in `listFriends`, not by the database: Prisma cannot order by `lower(name)`, and a plain `orderBy` follows the database's collation, which differs between installations (a case-sensitive one puts every capitalised name before every lower-case one). Names that differ only in case (`bob` and `Bob`) are ordered by user ID, so the order never changes from one call to the next. Names are letters and digits only, so lower-casing them is enough. When the list gets `limit`/`before`, the order has to move into the query (a raw `ORDER BY lower(name), id`)
- no rate limiter: it only lists the requester's own friends, so it reveals nothing about other users. No pagination yet (friend lists are small); add `limit`/`before` in the style of `GET /api/chat/:chatid/message` if that stops being true

DELETE /api/friend/:id

- deletes both `FriendListMember` rows of the pair (`deleteMany` with an `OR` over the two directions, in one transaction). Two users are friends when the *requester's own* row names `:id`, the same row `GET /api/friend` and `GET /api/friend/search/:tel` read. A user who does not exist, a stranger and the requester's own ID all get the same `404`, so nobody can probe which user IDs exist. A half-written friendship (only one of the two rows, which the API itself never produces) is therefore removed, both rows, by the user whose row exists, and answers `404` for the user whose row is missing
- a double click or a second tab sending the same request twice at once, or both friends unfriending each other at the same instant, is answered with `204` and `204`, or `204` and `404`, never a `5xx` (unlike accepting, the two rows are removed by one `DELETE` statement, so no fixed row order is needed); either way the friendship is gone
- no rate limiter: it only works on the requester's own friend list, so it reveals nothing about other users
- it does not touch pending friend requests (a pair that are friends has none, because accepting clears them)

Friendship and messaging (implemented)

The rules are in `./api.doc.md`, "Friendship requirement". Friendship is required to start a conversation because, before this rule, `POST /api/chat` and `POST /api/chat/:chatid/member` accepted any existing user ID, and user IDs are sequential integers, so anyone signed in could start a conversation with anyone, and read their name and avatar from the response.

- the all-or-nothing answer matches the rule these endpoints already follow: one user who is not a friend refuses the whole request, and a room is never created without its members
- a user ID that does not exist gets the same `403` as a stranger, so nobody can probe which user IDs exist. This replaced the old `400` for an unknown ID on these two endpoints. A member ID below 1 or above 2147483647 is still a `400` on both, because the database would refuse the lookup (`POST /api/chat` used to answer `500` for such an ID)
- unfriending never removes anyone from an existing room. If harassment after unfriending becomes a concern, that is what a block feature would be for, and it is out of scope here
- the check is not locked against a concurrent unfriend: a friendship removed at the same instant counts as the friendship it was when checked. A user deleted after the check but before the insert fails the foreign key and gets the same `403`
- the check lives in `findNonFriendIds` (`friend.service.ts`), which the chat-room services call; it is the only place where the chat-room module reads the friend list

### Email delivery

Shared by email verification and password reset. The mailer, its settings and the test outbox are implemented; email verification is the first feature that sends mail (its mail is composed in `modules/account/emailVerification.mail.ts`), and password reset is the second (`modules/account/passwordReset.mail.ts`).

- **Provider: Resend**, through its official `resend` package (`new Resend(apiKey).emails.send({ from, to, subject, text })`). It is one API key and one HTTPS call, with no SMTP host, port or TLS settings, and no trouble on hosts that block outbound SMTP. Its free plan (3,000 emails a month, at most 100 a day, one domain, per Resend's pricing page when this was written) is far above what a personal project sends. Nodemailer was the alternative, but it is only a library for talking SMTP, so choosing it would still mean choosing an SMTP provider; the `Mailer` interface below keeps the provider replaceable (a Nodemailer implementation would be one more file).
- **What it costs:** sending to real users needs a domain you own, verified in Resend by adding the DNS records it lists (SPF and DKIM). Until then `onboarding@resend.dev` can only deliver to the address of the Resend account itself and answers `403` for anyone else, so real emails can be tried end to end only with your own address.
- The Resend SDK does not throw on API errors: `emails.send` resolves to `{ data, error }`. The Resend mailer must check `error` and throw, otherwise failed sends disappear silently.
- `src/lib/mailer.ts` holds the `Mailer` interface (`send({ to, subject, text }): Promise<void>`), a console mailer that only logs (the default outside production), the Resend mailer, and `getMailer` / `setMailer` so tests can swap in an in-memory outbox (`test/helpers/mailer.ts`, emptied in `setup.ts`'s `beforeEach`).
- `server.ts` installs the real mailer with `setMailer(createMailerFromConfig(config))` before `app.listen`, never `app.ts`, like the cleanup job, so tests that import the app do not build one. `getMailer()` throws when nothing was installed instead of falling back to the console mailer, so a process that forgot the setup cannot print tokens to its log. The test setup installs the outbox, so `outbox.sent` holds exactly the mails a test's own requests caused.
- The console mailer prints the recipient, the subject and the whole text between two marker lines, so a link or token can be copied from the server log in development. It refuses to run in production for that reason.
- A refused or failed Resend call rejects with `Resend could not send the email (<error name>, HTTP <status>): <Resend's message>` (no status for a network failure; the recipient is not in the message, so logging it does not log an address), and the SDK's own error object is its `cause`. The SDK prints API errors itself outside production, so a failure shows up twice in a development log.
- New settings in `config.ts`, validated when the server starts like the cleanup job's: `MAIL_TRANSPORT` (`console` | `resend`; default `console`, and `resend` is required when `NODE_ENV=production`), `RESEND_API_KEY` and `MAIL_FROM` (for example `Message App <no-reply@yourdomain.com>`). `resend` without a key or a `MAIL_FROM` stops the server at start, as do an unknown `MAIL_TRANSPORT` and `console` in production (the message says which setting is wrong). Nothing needs configuring in development. To try Resend for real, create an API key in the Resend dashboard and put `MAIL_TRANSPORT=resend`, `RESEND_API_KEY=re_...` and `MAIL_FROM=Message App <onboarding@resend.dev>` in `server/.env`; until a domain is verified, the only recipient that works is the Resend account's own address.
- A request never waits for the mail (a rule for the controllers that send, not for the mailer; signup and `POST /api/account/email/verification` follow it, through `sendVerificationEmail`, which never rejects): the controller responds first, then sends inside a `try/catch` that logs a failure. The response time must not show whether a mail was sent (the reset flow depends on that), and a provider outage must not turn signup into a `500`. The price is that a failed mail is lost and the user asks again; if that proves too unreliable, the next step is an outbox table drained by a job like the cleanup job.
- Mails are plain text: one sentence of context and the link.
- **Trying a real delivery by hand:** `npm run try:email -- <address>` (`scripts/try-email-flows.mjs`, run from `server/` while the server runs with `MAIL_TRANSPORT=resend`) signs up a throwaway account with that address, asks you to paste the link from each mail that arrives (the verification mail, the reset mail) and whether the password-changed notice came, checks the endpoints' answers around them (a changed token, a reused link, a weak password, the old session and password after the reset), and deletes the account again so the address can be reused. It is the only check of an actual delivery; with the `onboarding@resend.dev` sender the address has to be the Resend account's own. A reset can be asked for 3 times an hour per address, so it can run 3 times an hour with the same one.
- Tests: `test/lib/mailer.unit.test.ts` (no database: the settings checks, the console mailer, `getMailer` / `setMailer`, and the Resend mailer through the real SDK with `fetch` stubbed, so the request it builds and its handling of a `403`, a non-JSON `502` and a network failure are checked without a key or network) and `test/lib/mailerOutbox.test.ts` (the outbox is the app's mailer and is emptied between tests). Not covered, because it needs a real key and a verified domain: an actual delivery.

### Email verification (implemented)

Goal: prove that the owner of an account can read mail sent to its address. An unverified address can be a typo or someone else's, and a password reset link takes over an account, so reset must not be sent to an address nobody has proven. The two endpoints are specified in `./api.doc.md` (`POST /api/account/email/verify` and `POST /api/account/email/verification`); this section is the design behind them. The code is `modules/account/emailVerification.service.ts` (the database work), `emailVerification.mail.ts` (the link, the mail and the settings check) and `emailVerification.validator.ts`; the two handlers are in `account.controller.ts`.

Database (migration `20261004120000_add_email_verification`):

- `users.email_verified_at`, a nullable timestamp: `null` means unverified. Existing accounts are not backfilled, because that would claim proof nobody gave: they start unverified and verify by asking for an email after logging in.
- `email_verification_tokens`: `user_id` (primary key, so one row per user, and deleted with the user), `email`, `token_hash` (unique), `expires_at`, `created_at`. Asking again replaces the row. `email` is the address the link was issued for: confirming only counts while it is still the user's address, and the same row can carry a pending change of address (see "Changing the address"), so no second table is needed. Expired rows stay until replaced or until the user is deleted; there is at most one per user, so no cleanup job.
- The token is `generateToken()` (the generator behind session ids); only its SHA-256 (`hashToken`, `src/lib/randomToken.ts`) is stored, so a leaked table gives nobody a working link.

Settings in `config.ts`, checked when the server starts by `checkEmailVerificationSettings` (called from `server.ts`, like the mailer's settings); a bad one stops the server and the message names it:

- `EMAIL_VERIFICATION_TTL_MS`: how long a link works. A whole number of milliseconds from 1 to 365 days, default 24 hours (`86400000`). Like every number in `config.ts` it is read with `Number`, not `parseInt` (see "Conventions"): `24h` is `NaN` and stops the server, instead of becoming a link that dies after 24 milliseconds.
- `EMAIL_VERIFICATION_URL`: the frontend page the link opens, an absolute `http` or `https` URL with no `#` in it (a query string is fine). Default `http://localhost:5173/verify-email` outside production; required when `NODE_ENV=production`, so a mail can never point at localhost.

Flow:

1. `POST /api/account/signup` creates the user as it does now (same `201` and body, `email_verified_at` null) and stores the token row in the same statement (`createUser` does a nested create), so an account never exists without the link that was mailed for it. After responding, the controller mails the link through `sendVerificationEmail`. Signup does not log in. A refused signup (`400`, `409`, including the one that loses a race for the address) stores and mails nothing.
2. The mail is plain text, subject `Confirm your email address`, one sentence and the link `EMAIL_VERIFICATION_URL#token=...`. A fragment is never sent to a server, so the token stays out of access logs and `Referer` headers. The frontend page reads it and sends it to the API as a `POST`, not as a link straight to a `GET` endpoint, because mail scanners and link previewers open links on their own and would use up the token before the user does. `sendVerificationEmail` never rejects: a request does not wait for its mail (see "Email delivery"), so a failed send is logged (without the address or the token) and the mail is lost. The user asks again with `POST /api/account/email/verification`.
3. `POST /api/account/email/verify` (`verifyEmailToken`) runs in one transaction: it finds the row by the token's hash, deletes it only while `expires_at` is still in the future, and then sets `email_verified_at` on the user only if the user still has the row's address and is not verified yet. Only one of two simultaneous requests can delete the row (the other waits for the first transaction, then finds it gone), so a link works once. If any step finds nothing, the answer is the same `400`, for an unknown, used, expired or replaced token and for a link issued for an address the user no longer has. An account that is verified already keeps its first timestamp and the answer is still `204`. An expired row is left where it is; a link for another address is consumed, since nothing could use it.
4. `POST /api/account/email/verification` (`issueEmailVerification`) locks the user's row (`SELECT ... FOR UPDATE`) before it looks at the stored link. Without the lock two simultaneous requests could both find the link older than a minute and both send a mail; with it the second waits, sees the link the first one stored, and is told to wait. The new link replaces the old one in the same row (an upsert on `user_id`, which also resets `created_at`, the start of the next cooldown). The caller is signed in, so there is nothing to hide and the answers are explicit. This is the "resend" button, and how accounts created before email verification verify.
5. The user shape (login, `GET /api/account/me`, `PATCH /api/account/me`, and `req.user`) gains `emailVerified: boolean`, so the frontend can show a "verify your email" banner. The timestamp itself is never sent. `toPublicUser` (`account.service.ts`) builds the shape from `userSelect`, and `findSessionUser`, `updateUserProfile` and login all use it, so the three bodies cannot drift apart.

All the times in the service are JS `Date`s handed to Prisma (the same as everywhere else in the project), never the database's `now()` and never a column default: `created_at` is set from the same `now` as `expires_at`, so a link lives exactly `EMAIL_VERIFICATION_TTL_MS`. The columns are `timestamp` without a time zone, so comparing one with `now()` is off by the session's UTC offset on any connection whose `TimeZone` is not UTC. The tests run in such a zone (see "Test database setup"), which is what makes that mistake fail in them. The service functions take `now` as an optional argument, which is how the tests check the expiry and the cooldown to the millisecond.

What verification gates:

- Required: password reset sends only to verified addresses (see "Password reset (implemented)").
- Not gated: login, chat and friends. Blocking login until verified would lock out someone who mistyped the address, who can never receive the link and has no way yet to change the address.
- Optional later: a `requireVerifiedEmail` middleware on the actions spammers want (for example `POST /api/friend/requests` and `POST /api/chat`), so throwaway accounts are less useful. Best added once the frontend can prompt for verification.

Changing the address (optional and not built; it is the way out of a typo): `POST /api/account/email`, signed in, body `{ email, password }` (the password like `DELETE /api/account/me` asks for it; the email follows signup's rules, lower-casing included; `409` when it belongs to another account). It writes a token row whose `email` is the new address, replacing any pending one, and sends the link to the new address only. Confirming through `POST /api/account/email/verify` then sets the user's `email` from the row and `email_verified_at` in one transaction (a unique violation there is `409 { "error": "Email already in use" }`), and the old address gets a "your email was changed" mail. Until then the old address stays the login. Building it changes step 3 above: the update there currently requires the user to still have the row's address, and would instead apply the row's address.

Known limit: signup answers `409` for a registered address even when it was never verified, so someone can register an address they do not own and keep its real owner out. If that matters, a signup for an address held by an unverified account older than some number of days could take the account over. Out of scope here.

Account deletion needs no change: the token row is deleted with the user (covered by `emailVerificationToken.schema.test.ts`).

Tests (all with the in-memory outbox):

- `emailVerification.service.test.ts`: a link works until the moment it expires and not at that moment, once even for two simultaneous requests, and not after a newer link replaced it; a verified account keeps its first timestamp; a link for another address is refused; the cooldown lasts exactly 60 seconds; two simultaneous resends issue one link; `409` and a missing account.
- `emailVerify.test.ts` and `emailVerifyLimiter.test.ts` for `POST /api/account/email/verify`, and `emailVerificationResend.test.ts` for `POST /api/account/email/verification` (`401`, `204` and the mail, replacing the old link, `409`, `429`, a failing or hanging mailer, the per-user limiter).
- `signup.test.ts`: signup mails exactly one working link and stores only its hash, does not log in, mails nothing when refused, and does not fail or wait when the mail does.
- `emailVerified` in the three user bodies (`session.test.ts`, `profile.test.ts`); a table of bad bodies in `emailVerification.validator.unit.test.ts`; the settings checks, the link and the send helper in `emailVerification.mail.unit.test.ts`; `hashToken` in `randomToken.unit.test.ts`; how every numeric setting is read in `config.unit.test.ts`, and `checkSessionSettings` in `session.settings.unit.test.ts`.

Not covered, because it needs a real key and a verified domain: an actual delivery (see "Email delivery").

The two frontend pieces (the banner with a resend button, and the page that reads the fragment and posts it) belong to the frontend milestone (step 2 of `./frontend.doc.md`). Until then the link is tried with the token from the console mailer's log.

### Password reset (implemented)

A signed-out user who forgot their password asks for a link by email, opens it, and sets a new password. It is two endpoints and one table, on top of the mailer from "Email delivery" and the verified addresses from "Email verification (implemented)". The two endpoints are specified in `./api.doc.md` (`POST /api/account/password/reset-request` and `POST /api/account/password/reset`); this section is the design behind them. The code is `modules/account/passwordReset.service.ts` (the database work), `passwordReset.mail.ts` (the settings check and the two mails) and `passwordReset.validator.ts`; the two handlers are in `account.controller.ts`.

Decisions:

- **Only verified addresses get a reset link.** A reset link takes over the account, so it goes only to accounts with `email_verified_at` set. For an unverified account, `reset-request` sends the verification email instead (under the verification cooldown) and gives the same `202`, so someone who never verified is not locked out: they verify, then ask again. This makes email verification a prerequisite, and it is built.
- **Where the link points.** `PASSWORD_RESET_URL` is the frontend page (`http://localhost:5173/reset-password` in development) and the token is appended as a URL fragment, `...#token=...`, for the reasons given under email verification. The frontend does not exist yet, so until it does the endpoints are exercised with the token from the logged mail.
- **Email matching is not case-sensitive**, like login. The validator hands the service the lower-cased address (`normalizeEmail`), and the lookup (`email = ${email}`) is an exact match on the stored form, which is lower case. Asking for `JOHN@x.com` finds the account created as `John@x.com`, and the mail goes to the stored address. The per-email limiter keys on the same canonical form, so every spelling shares one budget.
- **The answer never depends on the account.** `reset-request` finishes all its database work, then answers `202`, then sends the mail, so neither the status, the body nor a failed or slow mail shows whether an account exists. Known limit: an address with an account does one more write before answering than an unknown one, so the answer is a few milliseconds slower; nothing pads that.

Database (migration `20261008120000_add_password_reset`, written by hand like the verification one, because the schema engine is not available everywhere): one new table, `password_reset_tokens`, shaped like `email_verification_tokens` without the `email` column: `user_id` (primary key, deleted with the user), `token_hash` (unique), `expires_at` and `created_at`. An account has at most one outstanding link: asking again replaces it, so the table never grows past one row per user and needs no cleanup job (an expired row stays until it is replaced). `test/account/passwordResetToken.schema.test.ts` guards those rules.

- the token is `generateToken()` and only its SHA-256 is stored (`hashToken`). Time to live: `PASSWORD_RESET_TTL_MS`
- services never send mail themselves: they return what is needed and the controller sends it after responding

Settings in `config.ts`, checked when the server starts by `checkPasswordResetSettings` (called from `server.ts`, like the other settings checks); a bad one stops the server and the message names it:

- `PASSWORD_RESET_TTL_MS`: how long a link works. A whole number of milliseconds from 1 to 24 hours, default 30 minutes (`1800000`). The ceiling is lower than the verification link's year because a reset link takes over the account: a longer lifetime is a typo in the unit. Read with `Number`, so `30m` is `NaN` and stops the server.
- `PASSWORD_RESET_URL`: the frontend page the link opens, an absolute `http` or `https` URL with no `#` in it. Default `http://localhost:5173/reset-password` outside production; required when `NODE_ENV=production`. The URL rules are shared with email verification (`checkFrontendPageUrl` and `buildTokenLink` in `src/lib/frontendLink.ts`), so the two cannot drift apart.

`POST /api/account/password/reset-request` (`issuePasswordReset`):

1. One transaction. It locks the account's row (`SELECT ... FOR UPDATE`, found by the address as the validator lower-cased it), as `issueEmailVerification` does: without the lock two simultaneous requests could both find the stored link older than 60 seconds, and both send a mail. With it the second waits, sees the link the first one stored, and gets nothing.
2. An unverified account gets the verification link instead, stored by `issueEmailVerification` inside the same transaction (it takes the optional transaction as its last argument), so the account cannot become verified between the check and the store. Its cooldown is the verification one.
3. For a verified account, a stored link younger than 60 seconds means nothing is stored or sent; otherwise a new token replaces the old one (an upsert on `user_id`, which also resets `created_at`, the start of the next cooldown).
4. The result tells the controller what to mail (`reset_link`, `verification_link`) or that there is nothing to send (`unknown_email`, `cooldown`). The controller answers the same `202` for all four.

`POST /api/account/password/reset` (`resetPasswordWithToken`):

1. The controller validates the body, including the password rules, and hashes the new password before it looks at the token, so a weak password does not use up the link and an unknown token takes as long to answer as a good one.
2. One transaction: find the row by the token's hash; lock the user's row; delete the token row while `expires_at` is still in the future (`deleteMany` with `expiresAt: { gt: now }`, `now` a JS `Date` and not the database's `now()`, for the reason given under "Email verification (implemented)"; a count of `1` means this request claimed the token); store the new hash; delete all of the user's sessions (expired ones too). Of two simultaneous requests with the same token only one can claim the row (the other waits for the user row, then finds the token gone), so a link works once, and a failure rolls everything back, so the link survives it.
3. Lock order: the user row first, then the token row, in both services. An account deletion locks the user row and then cascades to the token row, so a reset that took them the other way round could deadlock with a deletion of the same account.
4. The answer is `204`, and the user is not signed in: they log in with the new password, so `loginLimiter` stays in the path. After the response a "your password was changed" mail goes to the account's address, so a takeover does not go unnoticed. It has no link in it.

Mails are plain text, one sentence each: `Reset your password` carries the link `PASSWORD_RESET_URL#token=...`, and `Your password was changed` carries nothing secret. Both send helpers never reject (see "Email delivery"): a failed send is logged without the address or the token and the mail is lost.

Changes to existing code: `changePassword` also deletes the account's reset token in its transaction (a link asked for earlier must not outlive a deliberate password change, and it only does so when the change really happens). `deleteAccount` needs nothing, the token goes with the user. `issueEmailVerification` takes an optional transaction, and the verification mail module uses the shared URL helper.

Tests (all with the in-memory outbox):

- `passwordReset.service.test.ts`: a link works until the moment it expires and not at that moment, once even for two simultaneous requests (tried on eight accounts, because two requests do not always overlap), and not after a newer one replaced it; the cooldown lasts exactly 60 seconds; two simultaneous requests issue one link; an unverified account gets the verification link and its cooldown; a reset signs out every session, expired ones included, and touches nobody else; a failing step rolls back and the link survives.
- `passwordReset.lockOrder.test.ts`: a reset that overlaps a deletion of the same account does not deadlock (the overlap is built by hand with a second connection).
- `passwordResetRequest.test.ts` and `passwordResetConfirm.test.ts` for the two endpoints (the answer is the same for a known and an unknown email, and only a verified one gets exactly one reset mail; another case of the address finds the account and the mail goes to the stored address; an unverified account gets the verification mail instead; the cooldown; a weak password is a `400` and the link still works afterwards; a reset signs out every session without signing in, the new password logs in and the old one does not; the notice mail; a failing or hanging mailer).
- `passwordResetRequestIpLimiter.test.ts`, `passwordResetRequestLimiter.test.ts` (per email) and `passwordResetLimiter.test.ts`, one file each, by limiter (a test there uses up the limiter's whole budget, and the next test gets it back: `test/setup.ts` resets every limiter before each test).
- `password.test.ts`: `changePassword` kills an outstanding link, and only that account's, and only when the change happens.
- `passwordReset.validator.unit.test.ts` (tables of bad bodies), `passwordReset.mail.unit.test.ts` (the settings checks and the two send helpers), `accountRateLimit.unit.test.ts` (the key of the per-email limiter), and `PASSWORD_RESET_TTL_MS` in `config.unit.test.ts`.

Not covered, because it needs a real key and a verified domain: an actual delivery (see "Email delivery").

The two frontend pages (a form that asks for the email and shows the `202` message, and a page that reads the fragment, asks for the new password and sends the user to the login) belong to the frontend milestone (step 2 of `./frontend.doc.md`). Out of scope: reset by SMS through `tel`, security questions, locking an account after failed logins.

### Private chat room (implemented)

Every account has a private chat room, like "My Documents" in Zalo: a place to write notes and links to oneself, and a room the chat screens can be tried in before there are any friends. It is an ordinary direct room whose other member is a bot.

- The bot is one `users` row, shared by all accounts: `is_bot = true`, name `My Documents`, email `my-documents@bot.invalid`, tel `bot:my-documents`. The migration `add_private_chat_room` creates it, and `PRIVATE_ROOM_BOT_EMAIL` (`privateRoom.service.ts`) is the one value the code needs to find it. The room's name and avatar are the other member's, as in every direct room, so each user sees a direct room named `My Documents` in their room list. The email cannot receive mail (`.invalid` is reserved for that) and the tel is not a phone number, so no signup collides with either. The password hash is a real argon2 hash of a random secret that was thrown away: checking a password against it answers false, where a made-up string would make argon2 raise
- "Private" means "the bot is a member" (`isPrivateChatRoom`). Nobody can add a bot to a room (it is nobody's friend, see below), so no other room has one. A user has exactly one such room, and the bot has one for each account
- the room is made with the account: `createUser` creates the user (and the verification token, as before) and calls `createPrivateChatRoom` in the same transaction, with the user and the bot as admins, as in every direct room. A nested create cannot do it in one statement: Prisma leaves `members` out of a room that is created from a membership. The bot is connected by its email, so if the migration's row is missing, signup answers `500` and creates nothing, rather than an account without its room
- the migration also gives every account that already exists a room: the `DO` block between its `backfill: start` and `backfill: end` markers adds one for each account that shares no room with the bot, in id order. Running it again changes nothing, and `privateRoom.backfill.test.ts` runs that block on test data
- the bot is hidden by `isBot: false` (`NOT is_bot` in raw SQL) in each lookup that starts from something a user types or sends: `findUserByEmail` (login), the lock in `issuePasswordReset` (no reset or verification link is stored or mailed for it), `findUserByTel` (the friend search) and `createFriendRequest` (a request to its id answers `400 receiver_id does not refer to an existing user`, as for any id that is not a user). Login would fail without the filter too, since nobody knows the password; the filter is for the day somebody adds a login path or gives the bot a real hash. A room with the bot, or a group with it as a member, is refused as for any stranger (`403`, because the friendship check comes first and the bot has no friends)
- `GET /api/chat/:chatid/member` leaves the bot out (`getMembersForChatRoom`), so the owner of a private room is its only listed member. The one place the bot shows is the room's `name` and `avatarUrl` in `GET /api/chat` and `GET /api/chat/:chatid`, which is the point of it
- the room cannot be left: `DELETE /api/chat/:chatid/member/:userid` answers `403 You cannot leave your private chat room` (`removeMemberFromChatRoom` returns `'private_room'`, checked inside its transaction after the not-a-member check). A leave would end with a room that only the bot is in and nobody can reach. Direct rooms cannot be deleted through the API at all (`requireGroupRoom`), so there is no delete to refuse
- it goes with the account: `deleteAccount` reads the ids of the user's private rooms before deleting the user and deletes those rooms (their messages with them, by cascade) after the user row is gone, in the same transaction, so a refused deletion leaves the room alone. The room would otherwise stay for ever with the bot as its only member, and the cleanup job (see "Empty chat room cleanup") only collects rooms that have no member
- the bot never writes, so the room never has anything unread (`unreadCount` is `0`), and its `lastMessage` is the last thing the user wrote
- not done: the contract has no flag that says a room is the private one, so a client shows it as a direct room that sorts by activity like the others, and cannot pin it first or give it an icon. A `private: boolean` on `ChatRoomSummary` would be the smallest change if the screens want it
- tests: `privateRoom.test.ts` (what signup creates, who sees it, the refused signup and the missing bot, every way the bot is hidden, messages in the room, leaving, deleting the account) and `privateRoom.backfill.test.ts` (the bot row the migration made, the backfill). The test setup keeps the bot between tests (`user.deleteMany({ where: { isBot: false } })`) because the migration, not a test, creates it, and `countUsers()` in `test/helpers/users.ts` counts accounts without it. `createUser` in the helpers does not give a user a room, so existing tests are unchanged; `createPrivateRoom(userId)` does it where a test needs one

### Real-time events (planned)

The events and the handshake are specified in `./api.doc.md` ("Real-time events"). The server side is meant to stay a notification layer on top of the REST endpoints rather than a second way to write data, so validation, permissions and tests are reused as they are:

- a controller (or a small `events` module) emits after the service call succeeds. Services keep returning a result the caller can inspect, like `editMessage`'s `edited` / `unchanged`, so only real changes are broadcast. Services still never import Socket.io
- handshake: read the session cookie and resolve it with the same `getSessionUser` lookup; reject the connection without a valid session. In development the browser reaches Socket.io through the frontend's dev proxy (`/socket.io` with `ws: true`, to be added to `frontend/vite.config.ts` in step 6 of the frontend plan), so the handshake carries the same first-party cookie as the REST calls
- leaving, being removed, or a deleted room must also remove the affected sockets from `chat:<chatId>` (`socketsLeave`), otherwise a removed member keeps receiving that room's messages

## Project Structure

The repository contains a TypeScript/Express server with Prisma persistence, authentication, and the current chat-room backend implementation. The React frontend is scaffolded in `frontend/`; its own layout and conventions are described in `./frontend.doc.md`.
Generated files created by tools such as Prisma (`server/src/generated/`) are omitted from this structure, while the source-controlled Prisma schema remains documented.

The server is organized by feature: each folder under `src/modules/` holds everything for one feature (routes, controller, validators, services, feature-specific middleware and jobs). Only code shared by several features lives in `src/middlewares/` and `src/lib/`.

```text
message-app/
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
    │   ├── test-db.mjs              // up | down | deploy | reset for the test database
    │   └── try-email-flows.mjs      // manual: email verification and password reset with real mail, through a running server (npm run try:email)
    ├── src/
    │   ├── app.ts
    │   ├── server.ts
    │   ├── config/
    │   │   └── config.ts            // every number is read by numberSetting: Number(), blank = not set, never parseInt
    │   ├── contract/                // the shapes of the API's JSON, shared with the frontend (see "API contract" in Conventions)
    │   │   ├── types.ts             // Role, User, PublicUser, ChatRoomSummary/Detail, CreatedChatRoom, Member, Message, FriendRequest, Relationship, SearchResult
    │   │   ├── requests.ts          // request bodies and queries, snake_case as on the wire
    │   │   ├── responses.ts         // bodies of successful responses
    │   │   └── errors.ts            // ApiErrorBody and the error bodies with an extra key
    │   ├── lib/
    │   │   ├── constants.ts
    │   │   ├── emailAddress.ts      // validateEmail (validator.isEmail) and normalizeEmail (lower case): the one place that decides what an address is and how it is spelled; used by signup, login and the password reset
    │   │   ├── frontendLink.ts      // checkFrontendPageUrl (startup check of a setting that holds a frontend page address) and buildTokenLink (the page plus `#token=...`); used by the verification and reset mail modules
    │   │   ├── mailer.ts            // Mailer interface; console and Resend mailers; createMailerFromConfig, getMailer / setMailer
    │   │   ├── rateLimiter.ts       // createRateLimiter (the factory every limiter is made with) and resetRateLimiters (tests only: test/setup.ts calls it before each test)
    │   │   ├── randomToken.ts       // generateToken: 32 random bytes as base64url (session ids, emailed tokens); hashToken: its SHA-256, the only form of an emailed token that is stored
    │   │   ├── parseIdParam.ts      // numeric URL param -> ID or null (used by the chat and friend validators)
    │   │   ├── passwordHash.ts
    │   │   ├── prisma.ts
    │   │   └── validation.ts        // isValidHttpUrl, isRecord (used by the chat and account validators) and bodyFields (a request body read through a contract type; used by the account validators and login)
    │   ├── middlewares/             // shared by several features
    │   │   ├── ErrorHandler.ts      // every error body is { error }; keeps the status of 4xx errors Express raises; notFoundHandler answers unmatched routes with a 404
    │   │   ├── SessionCookie.ts     // set/clear/read the session cookie
    │   │   └── UserSessionAuth.ts   // requireUserAuth; AuthenticatedRequest, withUser and userKey (see "Typed requests" in Conventions)
    │   └── modules/
    │       ├── account/
    │       │   ├── account.routes.ts
    │       │   ├── accountRateLimit.middleware.ts   // loginLimiter, emailVerifyLimiter, passwordResetRequestIpLimiter and passwordResetLimiter (per IP), passwordCheckLimiter (per user; POST /api/account/password and DELETE /api/account/me share it), emailVerificationRequestLimiter (per user), passwordResetRequestEmailLimiter (per email; its key is passwordResetEmailKey)
    │       │   ├── account.controller.ts
    │       │   ├── account.service.ts
    │       │   ├── session.service.ts   // session database operations; checkSessionSettings (SESSION_TTL_MS, checked at startup)
    │       │   ├── emailVerification.service.ts   // newVerificationToken, issueEmailVerification (resend), verifyEmailToken
    │       │   ├── emailVerification.mail.ts      // settings check, the link, sendVerificationEmail (never rejects)
    │       │   ├── emailVerification.validator.ts // POST /api/account/email/verify body
    │       │   ├── passwordReset.service.ts       // newPasswordResetToken, issuePasswordReset (reset-request, under a row lock), resetPasswordWithToken
    │       │   ├── passwordReset.mail.ts          // settings check, sendPasswordResetEmail and sendPasswordChangedEmail (never reject)
    │       │   ├── passwordReset.validator.ts     // POST /api/account/password/reset-request and /reset bodies
    │       │   ├── login.validator.ts
    │       │   ├── deleteAccount.validator.ts   // DELETE /api/account/me body
    │       │   ├── password.validator.ts   // POST /api/account/password body
    │       │   ├── profile.validator.ts    // PATCH /api/account/me body
    │       │   └── signup.validator.ts
    │       ├── chatrooms/
    │       │   ├── chatRoom.routes.ts
    │       │   ├── chatRoom.controller.ts
    │       │   ├── chatRoom.validator.ts
    │       │   ├── chatRoom.serializer.ts       // the services' Dates and rows to the contract's chat shapes: toChatRoomSummary, toChatRoomDetail, toCreatedChatRoom, toMessage
    │       │   ├── chatRoomAuth.middleware.ts   // loadChatMembership, requireGroupRoom, requireChatAdmin; ChatRoomRequest and withChatMembership
    │       │   ├── chatRoom.service.ts
    │       │   ├── chatMember.service.ts
    │       │   ├── privateRoom.service.ts       // the bot's email, createPrivateChatRoom (signup), isPrivateChatRoom, findPrivateChatRoomIds (account deletion)
    │       │   ├── message.service.ts
    │       │   ├── chatRoomCleanup.service.ts
    │       │   └── chatRoomCleanup.job.ts
    │       └── friends/
    │           ├── friend.routes.ts
    │           ├── friend.controller.ts
    │           ├── friend.validator.ts
    │           ├── friend.serializer.ts       // a request's Date to the wire's ISO string, every field named: toFriendRequest
    │           ├── friend.service.ts
    │           └── friendRateLimit.middleware.ts   // per-user limiters (friendSearchLimiter, friendRequestLimiter)
    └── test/
        ├── setup.ts
        ├── helpers/                          // shared fixtures, not test files
        │   ├── users.ts                      // createUser, countUsers (without the bot), loginAs (session cookie without going through /api/account/login), createSessionRow
        │   ├── chatRooms.ts                  // createGroupRoom, createDirectRoom, promoteToAdmin, memberIdsOf, findBot, createPrivateRoom
        │   ├── emailVerification.ts          // tokenFromMail (the token in a mailed link), createVerificationLink (stores a link in a chosen state)
        │   ├── friends.ts                    // makeFriends, createFriendRequest (optional createdAt)
        │   ├── passwordReset.ts              // createVerifiedUser (optionally with a real password), createResetLink (stores a link in a chosen state)
        │   └── mailer.ts                     // InMemoryMailer and the shared `outbox` (installed as the app's mailer and emptied before each test by setup.ts)
        ├── account/
        │   ├── session.test.ts               // login, me, logout (and emailVerified in their bodies)
        │   ├── signup.validator.unit.test.ts // validateAccountBody: a field that is not a string, no body, the order of the rules (no database)
        │   ├── signup.test.ts                // includes the canonical-number and duplicate-spelling cases (phone number and email case), the 409 when the insert loses a race, the verification mail, login with any spelling of the address, and a 400 (not a 500) for a field that is not a string or a request without a body
        │   ├── profile.test.ts               // PATCH /api/account/me (and emailVerified in its body)
        │   ├── password.test.ts              // POST /api/account/password, and changePassword's stale-hash guard
        │   ├── emailVerificationToken.schema.test.ts   // the hand-written migration's rules: one token per user, unique hash, deleted with the user
        │   ├── user.schema.test.ts           // users.email: the CHECK constraint refuses capitals, the unique index still holds
        │   ├── emailVerification.service.test.ts       // expiry, one use, cooldown, row lock: the service called directly, with the races
        │   ├── emailVerify.test.ts           // POST /api/account/email/verify
        │   ├── emailVerifyLimiter.test.ts    // its per-IP limiter: one test uses up the whole budget, the next one starts with a full one again
        │   ├── emailVerificationResend.test.ts   // POST /api/account/email/verification
        │   ├── passwordResetToken.schema.test.ts   // the hand-written migration's rules: one token per user, unique hash, deleted with the user
        │   ├── passwordReset.service.test.ts       // expiry, one use, cooldown, row lock, rollback: the service called directly, with the races
        │   ├── passwordReset.lockOrder.test.ts     // a reset that overlaps a deletion of the same account does not deadlock
        │   ├── passwordResetRequest.test.ts        // POST /api/account/password/reset-request
        │   ├── passwordResetConfirm.test.ts        // POST /api/account/password/reset
        │   ├── passwordResetRequestIpLimiter.test.ts   // per-IP limiter of reset-request
        │   ├── passwordResetRequestLimiter.test.ts     // per-email limiter of reset-request
        │   ├── passwordResetLimiter.test.ts        // limiter of POST /api/account/password/reset
        │   ├── deleteAccount.test.ts         // DELETE /api/account/me, and deleteAccount's stale-hash guard and room lock
        │   ├── profile.validator.unit.test.ts
        │   ├── deleteAccount.validator.unit.test.ts
        │   ├── password.validator.unit.test.ts
        │   ├── emailVerification.validator.unit.test.ts
        │   ├── emailVerification.mail.unit.test.ts   // settings checks, link, send helper (no database)
        │   ├── passwordReset.validator.unit.test.ts
        │   ├── passwordReset.mail.unit.test.ts       // settings checks, the two send helpers (no database)
        │   ├── accountRateLimit.unit.test.ts         // passwordResetEmailKey (no database)
        │   └── session.settings.unit.test.ts         // checkSessionSettings (no database)
        ├── config/                           // mirrors src/config/
        │   └── config.unit.test.ts           // every numeric setting: the number that was set, blank = default, "7d" and the like = NaN
        ├── contract/                         // mirrors src/contract/
        │   ├── contract.unit.test.ts         // the folder's rules: its files import only each other, and none has a Date (no database)
        │   └── contract.usage.unit.test.ts   // the ways round it: a bare `res: Response`, a `req.user!`, a body or query read by hand (no database)
        ├── lib/                              // mirrors src/lib/
        │   ├── emailAddress.unit.test.ts     // validateEmail (any case is valid) and normalizeEmail (case only, idempotent; no database)
        │   ├── mailer.unit.test.ts           // settings checks, console mailer, getMailer / setMailer, Resend mailer (real SDK, stubbed fetch)
        │   ├── rateLimiter.unit.test.ts      // createRateLimiter limits and keeps counts of its own, resetRateLimiters gives the budgets back and refuses to run outside a test (no database)
        │   ├── validation.unit.test.ts       // bodyFields: the fields of a JSON object, none for no body or a body that is not an object (no database)
        │   ├── mailerOutbox.test.ts          // the test setup's outbox is the app's mailer and is emptied between tests
        │   ├── testTimeZone.test.ts          // the test connections run in a time zone that is not UTC (see "Test database setup")
        │   └── randomToken.unit.test.ts          // generateToken and hashToken
        ├── middlewares/                      // mirrors src/middlewares/
        │   ├── errorHandler.unit.test.ts     // the handler alone, with a fake response
        │   ├── UserSessionAuth.unit.test.ts  // withUser: runs the handler for a request with a user, an error for one without (session lookup replaced, no database)
        │   └── errorHandler.test.ts          // errors Express raises itself (malformed JSON, bad percent-encoding) and the 404 for routes nothing serves
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
        │   ├── privateRoom.test.ts           // the room signup creates, the bot hidden everywhere, leaving, deleting the account
        │   ├── privateRoom.backfill.test.ts  // the bot row of the migration, and its backfill block run on test data
        │   ├── chatRoomSummary.test.ts       // lastMessage and unreadCount of GET /api/chat and GET /api/chat/:chatid
        │   ├── chatRoom.validator.unit.test.ts
        │   ├── chatRoom.serializer.unit.test.ts  // timestamps become ISO strings, a field that is not named is not sent (no database)
        │   ├── chatRoom.controller.unit.test.ts  // getChatRoomById when the room is gone after the membership check (services replaced, no database)
        │   ├── chatRoomAuth.unit.test.ts     // withChatMembership and the guard of loadChatMembership: an error for a route mounted without its middleware (no database)
        │   ├── chatRoomCleanup.service.test.ts
        │   └── chatRoomCleanup.job.unit.test.ts
        └── friends/
            ├── friendSearch.test.ts          // GET /api/friend/search/:tel
            ├── friendRequests.send.test.ts   // POST /api/friend/requests
            ├── friendRequests.get.test.ts    // GET /api/friend/requests
            ├── friendRequests.accept.test.ts // POST /api/friend/requests/:id/accept
            ├── friendRequests.delete.test.ts // DELETE /api/friend/requests/:id
            ├── friends.list.test.ts          // GET /api/friend
            ├── friends.remove.test.ts        // DELETE /api/friend/:id
            ├── friend.permissions.test.ts    // sign-in guard, per route
            ├── friend.validator.unit.test.ts
            └── friend.serializer.unit.test.ts  // timestamp as an ISO string, a field that is not named is not sent (no database)
```

Conventions:

- File names follow `<subject>.<role>.ts`, for example `chatRoom.service.ts` or `login.validator.ts`.
- A new feature gets its own folder under `src/modules/` with its routes, controller, validator(s) and service(s); its router is mounted in `app.ts` under `/api/<feature>`.
- All database operations are kept in the `*.service.ts` files and go through the shared Prisma client from `src/lib/prisma.ts`. There is no separate repositories layer, so a transaction (room creation, member removal) stays inside one service function.
- A fixed technical limit shared by more than one module (for example the Postgres INTEGER max, reused as both an ID ceiling and a `setInterval`/`setTimeout` delay ceiling) is declared once in `src/lib/constants.ts` and imported everywhere it's needed, instead of being redeclared per file.
- Services never import Express (no `req`, `res` or cookies). HTTP concerns live in controllers and middleware, so other entry points, such as the future Socket.io handlers, can call the same services.
- Middleware used by a single feature lives in that feature's folder (for example `chatRoomAuth.middleware.ts`, `accountRateLimit.middleware.ts`, `friendRateLimit.middleware.ts`); `src/middlewares/` only holds middleware shared across features. Rate limiters follow the same rule: each feature keeps its own limiters, keyed by IP where nobody is signed in yet (`loginLimiter`) and by user id after `requireUserAuth` (`friendSearchLimiter`, `passwordCheckLimiter`).
- Error bodies: every `4xx` and `5xx` response has the shape `{ "error": "<text>" }`, whichever layer sends it (controller, feature middleware, rate limiter, `errorHandler`, `notFoundHandler`). `message` is not used for errors because it is already a success-body key for a chat message (`POST` and `PATCH /api/chat/:chatid/message` return `{ "message": { ... } }`), so a client could otherwise get a string and an object under the same key from one endpoint. Validators keep their own internal `{ valid: false, message }` result; the controller puts that text under `error`. A success body that only confirms an action (`201 { "message": "Account created successfully" }` from signup) is not an error body and is unchanged.
- Typed requests: Express types `req.user` and `req.chatMembership` as optional, because only the middleware in front of a route makes them true. A handler that needs them is written against `AuthenticatedRequest` (`req.user` is there) or `ChatRoomRequest` (`req.user` and `req.chatMembership`) and is mounted with `withUser(handler)` or `withChatMembership(handler)`, which check at run time that the middleware ran. That is one check in one place instead of a `!` in every handler, and a route mounted without its middleware answers `500` through the error handler (and is logged) instead of failing on `req.user.id`. A per-user rate limiter keys on `userKey` (`UserSessionAuth.ts`), which checks the same thing: it throws instead of counting everybody under one key. Every module is done: there is no `req.user!` left in `src/`.
- Comments: the code says how, the tests say what is guaranteed, the docs (`api.doc.md` for the contract, this file for implementation notes and business rules) say what an endpoint does, and a comment says why a line has to stay the way it is. A comment stays only if deleting it could lead a competent reader to break something: a lock (`SELECT ... FOR UPDATE`), a conditional write instead of read-then-write, the order of two checks, an answer that is the same on purpose (`404` for a stranger and for a made-up id), a race (a user deleted after the friendship check), a fact about the data (a soft-deleted message still counts), or what each outcome of a result union means. It sits right above the line it protects and is a few lines long. What an endpoint accepts and answers, its status codes, who may call it (the route chain) and a business rule stated as a rule belong in the docs, which are changed in the same patch as the code, and are not repeated in a comment. Not written: what the next line does, a route or file name (the router and the editor say which; about a hundred lines named a route without the `/api` prefix after it was added, and one pointed to a renamed file), a plan or a history ("later", "will use", "used to"), a pointer ("see X"). The chat room module follows this; the account and friends modules are brought over when they are reworked. A comment that is found stale is fixed or deleted at once, in the patch that finds it.
- API contract: the shapes of the API's JSON are written once, in `src/contract/` (`types.ts` for what the API returns, `requests.ts` for request bodies, `responses.ts` for response bodies, `errors.ts` for error bodies), and the frontend imports the same files as `@contract/...`, with `import type`. A contract file imports only other contract files, never Prisma, Express or `src/lib/`, because the frontend has none of them, and every value in it is JSON: a timestamp is a `string` there, and a service's `Date` is turned into one before it is sent (`test/contract/contract.unit.test.ts` checks both). Request bodies keep the wire's snake_case keys. A controller types its `res` with the contract (`Response<UserResponse | ApiErrorBody>`), so a body of another shape does not compile, and a validator reads its body with `bodyFields<SomeBody>(body)` from `src/lib/validation.ts`, so a key the contract does not have does not compile either. A validator still checks every field by hand: the types say which keys exist, not that a client sent them right. A service keeps its own types, with `Date`s (`ChatRoomSummaryData` is the contract's `ChatRoomSummary` with its two timestamps as `Date`s; `FriendRequestData` holds one too): the contract is the wire, not the service layer, and a serializer turns the one into the other. The chat room module's is `chatRoom.serializer.ts` and the friends module's `friend.serializer.ts`: each names every field it sends, so a column added to a table later is not sent until the contract has it, and it writes timestamps with `toISOString`, the string `JSON.stringify` would have written. Every module is typed, and `test/contract/contract.usage.unit.test.ts` keeps it so: every controller handler types its `res`, there is no `req.user!`, and a body or query is read only through a validator or `bodyFields`. A body type does not say which fields a client must send: that is the validator's job (`FriendRequestConflictBody` is an `ApiErrorBody` plus `requestId`, so a conflict answer that forgot the `requestId` still compiles, and the friends tests pin it). The folder is inside `src/` because `tsc` runs with `rootDir: ./src`: a `shared/` folder at the repository root would need the build changed.
- Session handling is split in two: `modules/account/session.service.ts` talks to the database, and `middlewares/SessionCookie.ts` reads, sets and clears the cookie.
- Background jobs live in the folder of the feature they belong to and are started from `server.ts`, never from `app.ts`, so tests that import the app do not start timers.
- `server.ts` checks the callback of `app.listen`: Express 5 passes a failed listen (a port that is already taken, for one) to it instead of throwing, so the callback logs the error and exits with code 1. Without the check the process printed "Server is running" and idled on the cleanup job's timer, serving nothing.
- Mail goes out through `getMailer()` from `src/lib/mailer.ts` and nowhere else: a feature never imports a mail provider's SDK, and services never send mail themselves. The real mailer is installed from `server.ts`, never `app.ts`; the tests install the outbox in `test/setup.ts`. A feature's mail (subject, text, link, and the send helper that logs a failure instead of throwing) is composed in its own `<feature>.mail.ts`, for example `emailVerification.mail.ts` and `passwordReset.mail.ts`.
- Tests live in `server/test/`, in a folder per feature that mirrors `src/modules/` (`test/account/`, `test/chatrooms/`, `test/friends/`; `test/middlewares/` mirrors `src/middlewares/`, `test/lib/` mirrors `src/lib/` and `test/config/` mirrors `src/config/`), and import from `../../src/...`. Shared fixtures live in `test/helpers/`. `loginAs(user)` creates the session row and sends its cookie directly, so no test outside `test/account/` depends on `/api/account/login` or its rate limiter.
- Every rate limiter is made with `createRateLimiter` from `src/lib/rateLimiter.ts`, never with `rateLimit` from `express-rate-limit` directly: the factory gives it a memory store of its own and remembers it, and `test/setup.ts` calls `resetRateLimiters` before each test, so every test starts with full budgets. Without that a limiter keeps its count for the whole test file, and one keyed by IP (`loginLimiter`, `emailVerifyLimiter`, `passwordResetRequestIpLimiter`, `passwordResetLimiter`) is shared by every request the test client sends, so a file would run out of budget part way and answer 429 to whichever test comes last. A test that wants a limit to fire sends the requests itself and may use up the whole budget (`emailVerifyLimiter.test.ts`); it is back for the next test. The limiters stay real in the path of every request: nothing is mocked or switched off in tests, and `resetRateLimiters` throws outside a test run.
- Numeric settings in `config.ts` (`PORT`, `SESSION_TTL_MS`, the cleanup job's two, `EMAIL_VERIFICATION_TTL_MS`, `PASSWORD_RESET_TTL_MS`) are read by `numberSetting`, which uses `Number()` and treats a blank value as not set (`0` is a value). Never `parseInt`: `parseInt('7d')` is `7`, a session that lasts 7 milliseconds, with nothing at startup to say so, while `Number('7d')` is `NaN`, which the startup check of the feature that owns the setting refuses (`checkSessionSettings`, `checkEmailVerificationSettings`, `checkPasswordResetSettings`, `startEmptyChatRoomCleanup`; `listen` refuses a `NaN` `PORT`). A new setting gets a check like those, and a case in `config.unit.test.ts`.
- Email addresses are handled through `src/lib/emailAddress.ts` and nowhere else: validators call `validateEmail` and `normalizeEmail` on the address from a request, and services take the lower-cased address as given. `users.email` is lower case by a CHECK constraint (`users_email_lowercase_check`, migration `20261017090000_require_lowercase_user_email`, written by hand like the others; the Prisma schema cannot express a CHECK constraint, so it is only in the migration and a comment in `schema.prisma`). Anything that writes or looks up `users.email` (a new endpoint, a seed script, a test that creates a user directly) uses the lower-cased address, or the database refuses the write. The migration fails on a database that already holds an address with capitals: lower-case those first.
- Times are JS `Date`s handed to Prisma (`expiresAt: { gt: now }`), never the database's `now()` in SQL: the `timestamp` columns hold UTC without a zone, so `now()` is off by the session's UTC offset wherever the database is not in UTC. A time that the code later compares with the JS clock is set explicitly instead of left to a column default. The `@default(now())` columns are filled by Prisma Client with the JS clock (checked on `email_verification_tokens.created_at` with the database in UTC+7), and the tests run in UTC+7 so a mistake here fails them (see "Test database setup").
- Each test file covers what its part of the code owns: an endpoint file covers that endpoint's business rules plus one bad-input case to prove the validator is wired in; the full list of bad inputs is a table in `chatRoom.validator.unit.test.ts` (no database); `chatRoom.permissions.test.ts` covers the shared guards once per route, so a new route should be added to its lists. Keep a new test only if it guards a rule that is not already covered by another one.
- `npm run build` runs `tsc` and then `scripts/fix-esm-imports.mjs`. The source keeps extensionless imports, but Node's ESM loader needs real file names, so the script rewrites the relative imports in `dist/` (`./app` becomes `./app.js`, a folder import becomes `./dir/index.js`) and fails the build if an import points at nothing. `npm start` runs `node dist/server.js`.

## Empty chat room cleanup

A room whose last member has left is not deleted on the spot. `DELETE /api/chat/:chatid/member/:userid` stamps the room's `emptied_at` column in the same transaction as the removal (`DELETE /api/account/me` does the same for a room whose only member was the deleted user), and a job running inside the API process deletes the room once it has stayed empty for the retention period. Deleting the room cascades to its messages.
The job is `modules/chatrooms/chatRoomCleanup.job.ts` (timer, validation of the two settings below) and the database work is `chatRoomCleanup.service.ts` (`purgeExpiredEmptyChatRooms`).

- `EMPTY_ROOM_RETENTION_MS`: how long a room stays empty before it is deleted (default 7 days)
- `EMPTY_ROOM_CLEANUP_INTERVAL_MS`: how often the job looks for expired rooms (default 1 hour); it also sweeps once when the server starts
- each sweep first stamps any empty room that has no `emptied_at` yet (a safety net: the two endpoints above already stamp the room themselves), so its retention clock starts then, and then deletes rooms whose stamp is older than the retention period
- a room that has members is never deleted, whatever its `emptied_at` says
- the job is started from `server.ts`, not `app.ts`, so tests that import the app do not start a timer
- a room with no members cannot be reached through the API (every `/api/chat/:chatid` route requires membership), so nothing can add members back to a room that is waiting for cleanup

## Cookie / CORS Notes

In development the frontend does not need CORS: its dev server (`http://localhost:5173`) proxies every request that starts with `/api` to this server (`http://localhost:3000`) unchanged (the routes themselves start with `/api`), so the browser sees one origin and the session cookie is a first-party cookie (see `./frontend.doc.md`, "How the frontend talks to the server"). The frontend sends every request with `credentials: 'include'`.

The session cookie is `HttpOnly` and `SameSite=Lax` (and `Secure` in production), so in production the frontend and the API have to be on the same site, for example behind one reverse proxy that routes `/api` here. Two things to do for that setup:

- `app.set('trust proxy', ...)` is not set in `app.ts`. Behind a reverse proxy every request would otherwise come from the proxy's address, and the IP-based rate limiters would give all users one shared limit.
- `cors` is not a dependency and `app.ts` does not use it; it is only needed if the frontend and the API end up on different origins. Then the cookie also has to become `SameSite=None; Secure` (see the comment in `middlewares/SessionCookie.ts`), and the server must allow credentials from the frontend's origin explicitly:

```ts
app.use(cors({ origin: 'https://app.example.com', credentials: true }));
```

and the frontend's requests would have to go to that origin instead of `/api`.

## Backend Data Flow

The backend follows a layered request flow:

1.**Request parsing and routing**

- Express receives the request and parses JSON bodies with `express.json()`.
- `cookie-parser` makes the session cookie available through `req.cookies`.
- The request is sent to the matching route under `/api/account`, `/api/chat` or `/api/friend`.

2.**Authentication**

- Account signup and login validate the incoming body in their controllers before calling the account services. Signup also makes the verification token (`newVerificationToken`), stores it with the user, and mails the link after it has responded.
- Login verifies the password, then `createSession` (`session.service.ts`) deletes the user's expired sessions and stores a new one (with a random 256-bit id from `generateToken`), and `setSessionCookie` (`middlewares/SessionCookie.ts`) sends the session cookie in the response.
- Protected chat-room and friend routes run `requireUserAuth`, which calls `getSessionUser` in `middlewares/SessionCookie.ts`: it reads the session cookie, resolves it through `findSessionUser` in `session.service.ts`, clears the cookie when the session has expired, and returns the user (the public shape, with `emailVerified`), which `requireUserAuth` attaches to `req.user`.
- `/api/account/me` uses the same `getSessionUser` lookup but returns `user: null` when no valid session exists. Logout deletes the session when present and clears the cookie.

3.**Route-level authorization**

- For routes containing `:chatid`, `loadChatMembership` checks the authenticated user's membership and the room type in one Prisma query.
- A valid membership is attached to `req.chatMembership` with the room ID, role, and room type.
- `requireGroupRoom` restricts group-only actions, while `requireChatAdmin` restricts administrative actions. Requests that fail these checks end before reaching the controller.

4.**Validation and controller handling**

- Controllers validate request bodies and URL parameters, then pass normalized values to the relevant service.
- Controllers coordinate the HTTP response: they choose the status code, select the response shape, and pass unexpected errors to the shared error handler.

5.**Service and database flow**

- Services contain all database operations and use the shared Prisma client from `src/lib/prisma`. They do not import Express.
- Account services create and find users, update a profile, change a password (`changePassword` also deletes the other sessions in the same transaction) and delete an account (`deleteAccount` locks the rooms the user is in, refuses while the user is the only admin of a group room that still has other members, and leaves the rest to the foreign keys). The session service creates, reads, and deletes sessions (rows only; cookies are handled in `middlewares/SessionCookie.ts`). The email verification service makes a token, replaces the account's link (`issueEmailVerification`, under a row lock) and uses a link (`verifyEmailToken`); it returns the token to mail and never sends it, the controller does that after responding. The password reset service does the same for the reset link: `issuePasswordReset` (under a row lock; an unverified account gets the verification link instead) and `resetPasswordWithToken` (claims the link, stores the new hash and deletes every session in one transaction).
- Chat-room services check with `findNonFriendIds` (from the friend service) that everyone being added is a friend of the requester, create rooms and memberships in a Prisma transaction, load direct and group rooms, retrieve the latest message that has not been deleted and the requester's unread count for room summaries, and update or delete rooms.
- Direct-room responses derive the room name and avatar from the other member; group-room responses use the room's own name and avatar fields.
- Friend services look up users and the friend-list and pending-request rows that connect them to the requester. Other users are returned as `{ id, name, avatarUrl }` only, never with `email` or `tel`.

6.**Response and error flow**

- Successful service results are mapped to JSON responses by the controller and returned to the client.
- Validation and authorization failures return directly from the relevant controller or middleware with an appropriate `4xx` status and an `{ error }` body.
- Unexpected service or Prisma errors are forwarded with `next(error)` and handled by the application's final error-handler middleware.
- The error handler answers `500 { "error": "Internal server error" }` for those and logs them. An error that carries its own `4xx` status (Express and body-parser set one) is answered with that status instead: a malformed JSON body or a path param with broken percent-encoding, such as `/api/chat/%E0%A4%A` or `/api/friend/search/%E0%A4%A`, is a `400`, not a `500`. Such an error is the client's mistake, so it is not logged, and its text is only sent to the client when the error marks it as safe to expose (otherwise the plain status text, for example `Bad Request`).

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

1. Build the React frontend and integrate it with TanStack Query, step by step (see `./frontend.doc.md`; step 1, the scaffold, is done)
2. Implement real-time communication with Socket.io, server and client together (see "Real-time events" and step 6 of the frontend plan)
3. Add authentication-aware UI states and protected routes (the route guards are in place; the sign-up, verification and reset screens are step 2 of the frontend plan)
4. Add deployment configuration and production hardening, including the Resend account and verified domain that production mail needs (see "Email delivery", "Email verification (implemented)" and "Password reset (implemented)")

## Notes

This document reflects the current state of the repository. The auth module and the core chat-room backend are in place and working;
the remaining messaging feature set is planned as incremental extension work for the app.
