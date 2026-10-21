# Message App API

The specification of the HTTP API the server exposes: what a client sends and what comes back (request bodies, response bodies, status codes, error texts, rate limits) and the rules a client has to know. It is the source of truth for the API: change it in the same patch as any change to an endpoint's request, response, status code or error body. The TypeScript shapes of the bodies are the one exception: they are code, in `server/src/contract/` (see "Shapes").

- How the endpoints are built and why (transactions, locks, limiters, files, tests, design decisions): `./backend.doc.md`, "API implementation notes".
- How the screens use the API: `./frontend.doc.md`.

## Conventions

- Every path below starts with `/api` (for example `POST /api/account/login`): the server itself serves its routes under that prefix, so the browser, the dev server's proxy and a reverse proxy in production all use the same path and nothing rewrites it (see "How the frontend talks to the server" in `./frontend.doc.md`). Bodies are JSON.
- The session is an `HttpOnly`, `SameSite=Lax` cookie set by login and cleared by logout and account deletion. Every request is sent with the cookie (`credentials: 'include'`).
- **Request bodies use snake_case, responses use camelCase.** Going out: `avatar_url`, `member_ids`, `receiver_id`, `message_id`, `current_password`, `new_password`. Coming back: `avatarUrl`, `createdAt`, `lastReadMessageId`, `unreadCount`.
- Ids are positive integers up to 2147483647 (a Postgres `INTEGER`). A path or query id that is not one answers `400`.
- Timestamps are ISO 8601 strings in UTC (`"2026-09-13T12:00:00.000Z"`).
- Every `4xx` and `5xx` has the body `{ "error": string }`. Two errors carry one extra key: `chatIds` (the `409` of `DELETE /api/account/me`) and `requestId` (the `409` "they already sent you a request" of `POST /api/friend/requests`). A malformed JSON body is a `400`.
- Without a session, every endpoint except the public ones answers `401 { "error": "Unauthorized Access" }`. Public: signup, login, logout, `GET /api/account/me` (never a 401), `POST /api/account/email/verify`, `POST /api/account/password/reset-request`, `POST /api/account/password/reset`.
- A path no route serves (a typo, a path without the `/api` prefix, a method the path does not have) answers `404 { "error": "Route not found" }`. Under `/api/chat` and `/api/friend` the session check runs first, so a signed-out client gets the `401` above there too.
- `204` has no body. `429` is a rate limit and its text is in `error` (the limits are in "Rate limits" at the end).
- Every `/api/chat/:chatid/...` path answers `400 Invalid chat room id` for an invalid `:chatid` and `404 { "error": "Chat room not found" }` when the requester is not a member (a room that does not exist gets the same answer). Both are left out of the endpoint lists below.
- A user is always shown to other users as `{ id, name, avatarUrl }`, never with `email` or `tel`.

## Shapes

The shapes of the JSON this API sends and receives are defined once, as TypeScript, in `server/src/contract/`. The server and the frontend both compile against that folder (the frontend imports it as `@contract/...`), so those files are the specification of the shapes, and the comment on a field says what it means:

- `types.ts`: `Role`, `User` (your own account), `PublicUser` (any other user, never with an email or a tel), `ChatRoomSummary`, `ChatRoomDetail`, `ChatRoomCore`, `CreatedChatRoom`, `Member`, `Message`, `FriendRequest`, `Relationship` and `SearchResult`.
- `requests.ts`: the request bodies, with their snake_case keys. `responses.ts`: the bodies of successful responses. `errors.ts`: `ApiErrorBody` and the error bodies that carry an extra key.

A change to a shape is made in those files, in the same patch as the code that sends it. This document keeps what a compiler cannot say: status codes, error texts, rules and who may call what. The endpoint sections below use the contract's names (`User`, `PublicUser`, ...).

The account endpoints are checked by the compiler on both sides: their controllers' responses and their validators' bodies on the server, `features/account/api.ts` on the frontend. The chat room endpoints are checked on the server (the frontend has no chat code yet). The friend shapes (`FriendRequest`, `Relationship`, `SearchResult`) are already in `types.ts`, but the friends controllers do not use them yet; their request, response and error types are added when that module is typed (see "API contract" in `./backend.doc.md`).

## Permission model

| Action | Admin | Member |
| --- | :---: | :---: |
| Send, read, edit own, delete own messages | yes | yes |
| List members, mark as read, leave | yes | yes |
| Rename the room or change its avatar, delete the room, add members, remove others, promote or demote | yes | no |

- Nobody edits or deletes another member's message, admins included: there is no moderation override.
- A direct room has exactly two members, both admins, and no name or avatar of its own. Its members cannot add or remove anyone, rename it or delete it; each can only leave it. Anything else answers `403`.

## Account endpoints

### POST /api/account/signup

Creates an account. Public. It does not sign the user in.

```json
{ "name": "JohnDoe", "email": "john@example.com", "tel": "+1234567890", "password": "Str0ng!Pass" }
```

- All four fields are required (`400 All fields are required`): a field that is empty or is not a string counts as missing, and so does a request without a JSON body. The rules are checked in this order and the first one that fails is the answer:
  - `name`: letters and digits only (`Name must contain only letters and numbers`).
  - `email`: a valid address (`Invalid email format`). Addresses are not case-sensitive: the server stores the address lower-cased, so `John@Example.com` and `john@example.com` are one account at signup, at login and at password reset, and `email` comes back lower-cased in every `User` body, whatever case it was typed in. Nothing else about the address is changed (no trimming, and dots and `+tags` stay).
  - `tel`: a valid international number with the leading `+` (`Invalid phone number format`). Spaces, dashes and parentheses are accepted and the number is stored in its canonical form, `+` and digits only (an extension is dropped), so `tel` always comes back canonical.
  - `password`: at least 8 characters with an upper-case letter, a lower-case letter, a digit and a special character (`Password must be at least 8 characters long`, `Password must contain at least one uppercase letter`, `...lowercase letter`, `...number`, `...special character`).
- There is no `avatar_url` at signup: a new account always has `avatarUrl: null`, and the user sets an avatar later with `PATCH /api/account/me`.
- The account starts unverified (`emailVerified: false`) and a verification link is mailed to the address (see "Mailed links").
- Response `201`: `{ "message": "Account created successfully" }`.
- `409` when the email or the phone number is taken: `Email already exists` or `Phone number already exists` (another spelling of a registered number counts, and so does another case of a registered address). When two signups collide at the same instant and the server cannot tell which field it was, the text is `Email or phone number already exists`.

### POST /api/account/login

Signs in. Public.

```json
{ "email": "john@example.com", "password": "Str0ng!Pass" }
```

- Response `200`: `{ "user": User }`, and the session cookie is set. The address is matched without regard to case, as at signup: `JOHN@Example.com` signs in to the account created as `john@example.com`.
- `400 Email and password are required` when either is missing or not a string, or when the request has no JSON body.
- `401 Invalid email or password`: the same answer for an unknown email and a wrong password.
- `429`.

### GET /api/account/me

The current user. Public, and never a `401`.

- Response `200`: `{ "user": User }`, or `{ "user": null }` when there is no valid session. `avatarUrl` is `null` until `PATCH /api/account/me` sets it, and `emailVerified` is `false` until the address is verified.

### POST /api/account/logout

Public: it also answers when there is no session.

- Response `200`: `{ "user": null }`. The session is invalidated and the cookie cleared.

### PATCH /api/account/me

Updates the requester's own profile. Requires a session.

```json
{ "name": "JohnDoe2", "avatar_url": "https://example.com/john.png" }
```

- At least one of `name` and `avatar_url`; only the fields that are sent change, and unknown fields (`email`, `tel`, `password`...) are ignored. Changing the email or the phone number is not supported.
- `name` follows signup's rule (letters and digits only) and must be a non-empty string. `avatar_url` is an `http:` or `https:` URL, or `null` to clear the avatar.
- Response `200`: `{ "user": User }`.
- `400`: `At least either 'name' or 'avatar_url' must be provided`, `'name' must be a non-empty string`, the signup text for a name that breaks the rule, `'avatar_url' must be a string or null`, `'avatar_url' must be a valid URL`.

### POST /api/account/password

Changes the password. Requires a session.

```json
{ "current_password": "Str0ng!Pass", "new_password": "An0ther!Pass" }
```

- Both are non-empty strings (`400` otherwise); `new_password` follows signup's password rules (`400` with the same texts). A new password equal to the current one is accepted.
- Response `204`. Every other session of the account is signed out; the session that made the request stays valid.
- `401 Current password is incorrect`. The session is still valid: this is a wrong password, not a lost session.
- `429`; the limit is shared with `DELETE /api/account/me`.

### DELETE /api/account/me

Deletes the requester's own account. Requires a session.

```json
{ "password": "Str0ng!Pass" }
```

- `password` is the current password, a non-empty string (`400 Password is required`).
- Response `204`, and the cookie is cleared. The email and the phone number can be used to sign up again.
- `401 Password is incorrect`. The session is still valid.
- `409` when the requester is the only admin of a group room that still has other members. Nothing is deleted. The body lists those rooms so the client can send the user there; they make someone else an admin or delete the room, then try again:

  ```json
  {
    "error": "You are the only admin of a group room that still has other members. Make someone else an admin or delete the room first",
    "chatIds": [3, 8]
  }
  ```

  Direct rooms are exempt, and so are group rooms where the requester is the only member.
- What other users see afterwards: the account's messages stay in their rooms with `senderId` and `sender` set to `null` (nobody can edit or delete them any more); a direct room stays with its remaining member, who still lists and reads it, with `name` and `avatarUrl` `null`; the friend-list entries and friend requests (sent and received) are gone.
- `429`; the limit is shared with `POST /api/account/password`.

### POST /api/account/email/verify

Confirms an address with the token from a verification mail. Public: the token is the credential, and the link is often opened on another device.

```json
{ "token": "..." }
```

- Response `204`; `emailVerified` is `true` from then on. A link works once.
- `400 Token is required` when it is missing or not a non-empty string.
- `400 This verification link is invalid or has expired`: one text for a token that is unknown, already used, expired, replaced by a newer link, or issued for an address the account no longer has.
- `429`.

### POST /api/account/email/verification

Mails a new verification link to the signed-in user's current address; the old link stops working. This is the "resend" button. Requires a session, no body.

- Response `204`; the mail goes out after the response.
- `409 Email is already verified`.
- `429 Please wait a minute before asking for another email` while the stored link is younger than 60 seconds (nothing is sent and the stored link stays valid), and `429 Too many verification emails requested, try again later` for the hourly limit.

### POST /api/account/password/reset-request

Asks for a password reset link by email. Public: whoever asks has forgotten the password.

```json
{ "email": "john@example.com" }
```

- Response `202`: `{ "message": "If an account exists for that email, a reset link is on its way" }` for every well-formed address, whether or not an account has it, so the answer cannot be used to find out who is registered. Word the screen's confirmation the same way and never promise that a mail was sent.
- What happens behind that answer: a verified account gets a reset link, which replaces the old one; an unverified account gets the verification mail instead (a reset link goes only to an address someone has proven); an unknown address, or an account whose stored link is under 60 seconds old, gets nothing. The address is matched without regard to case, like login.
- `400 Email is required` when it is missing or not a non-empty string; `400 Invalid email format` when it is not an address.
- `429`: `Too many attempts, try again later` (per IP) or `Too many password reset requests, try again later` (per email). Every request counts, so a `429` reveals nothing either.

### POST /api/account/password/reset

Sets a new password with the token from a reset mail. Public: the token is the credential.

```json
{ "token": "...", "new_password": "An0ther!Pass" }
```

- Response `204`. It does not sign the user in: they log in with the new password. Every session of the account is deleted, a link works once, and a "your password was changed" mail goes to the account's address.
- `400 Token and new password are required` when either is missing or not a string. `new_password` follows signup's password rules (`400` with the same texts) and is checked first, so a weak password does not use up the link.
- `400 This reset link is invalid or has expired`: one text for a token that is unknown, already used, expired or replaced by a newer link.
- `429`.

### Mailed links

- The verification mail (sent at signup, by `POST /api/account/email/verification` and by `POST /api/account/password/reset-request` for an unverified account) carries `EMAIL_VERIFICATION_URL#token=...`; the reset mail carries `PASSWORD_RESET_URL#token=...`. Both are pages of the frontend, and the token is in the URL fragment, so it never reaches a server log or a `Referer` header. The page reads it from `location.hash`, posts it to the endpoint above and removes it from the address bar. It must be a `POST`, not a link straight to a `GET`: mail scanners and link previewers open links on their own.
- A link that cannot be mailed does not fail the request: the user asks again.
- Nothing is blocked for an unverified account except password reset.

## Chat room endpoints

All of them require a session.

### Friendship requirement

Nobody can start a conversation with a stranger: whoever is invited to a room has to be a friend of the requester.

- `POST /api/chat`: for a direct room the other user must be a friend; for a group room every `member_ids` entry must be (the requester's own id is dropped first). A group room created with no `member_ids` needs no friends.
- `POST /api/chat/:chatid/member`: every user who would be *added* must be a friend. A user who is already a member (the requester included) is skipped, friend or not.
- "Friend" means the requester's own friend-list row names the user. The members of a group do not have to be friends with each other, only with whoever adds them.
- A refusal is `403 { "error": "Only your friends can be added to a chat room" }` and changes nothing: one user who is not a friend refuses the whole request, and a room is never created without its members. A user id that does not exist gets the same `403` as a stranger, so ids cannot be probed. An id below 1 or above 2147483647 is still a `400`. The check runs after validation and, on `POST /api/chat/:chatid/member`, after the group-room and admin guards (`403` with their own texts).
- For a direct room the check comes before the lookup of an existing room: two people who are no longer friends get `403`, not their old room back.
- Unfriending never removes anyone from an existing room, and the room keeps working: the former friends can still read and send messages in it and `GET /api/chat` still lists it. What stops is *new* conversations: a new direct room, or adding that user to a group.

### POST /api/chat

Creates a room, or reuses the existing direct room between the two users.

```json
{ "type": "group", "member_ids": [2, 3], "name": "Project chat", "avatar_url": "https://example.com/project-chat.png" }
```

- `type` is `"direct"` or `"group"` (`400 type must be "direct" or "group"`).
- `member_ids` is an array of user ids (`400 member_ids must be an array of user IDs`); duplicates and the requester's own id are dropped.
- A direct room needs exactly one other id (`400 a direct chat room requires exactly one other member`) and cannot have a name or an avatar (`400 direct chat rooms cannot have a name or avatar`).
- A group room may omit `member_ids` or send an empty array (the creator is its only member). The requester is always added as an admin, everyone else as a member. `name` and `avatar_url` are optional: `name` is a non-empty string of at most 100 characters after trimming (it is stored trimmed; `400 name must be a non-empty string if provided`, `400 name must be 100 characters or fewer`), `avatar_url` an `http:` or `https:` URL (`400 avatar_url must be a string if provided`, `400 avatar_url must be a valid URL`). These are the same rules as `PATCH /api/chat/:chatid`.
- Response `201` for a new room and `200` when an existing direct room is reused: a `CreatedChatRoom`. The room is returned as stored, not as a summary (no `lastMessage`, `unreadCount` or `role`), and for a direct room `name` and `avatarUrl` are `null`: show the other member from `members`. Only `GET /api/chat` and `GET /api/chat/:chatid` derive them. Merge it into the room list or refetch `GET /api/chat`, do not write it over a `ChatRoomSummary`.
- `403 Only your friends can be added to a chat room` (see "Friendship requirement").

### GET /api/chat

The rooms the requester is a member of, direct and group alike.

- Response `200`: `{ "chatRooms": ChatRoomSummary[] }`, sorted by the time of the last message, newest first; a room without messages sorts by its creation time. No pagination.
- A direct room's `name` and `avatarUrl` are the other member's name and avatar (`null` when they are gone or have none).
- `lastMessage` is the newest message that has not been deleted, or `null`. It has no id and no sender, and it never has `content: ""`: a deleted message is skipped and the one before it is shown. So deleting the newest message also moves the room down the list, and editing it changes the preview.
- `unreadCount` is the number of messages in the room above the requester's own `lastReadMessageId` (every message counts while it is still `null`), not sent by the requester and not deleted. A message whose author deleted their account still counts. It is `0` when nothing is unread, never absent. A member added to a room that already has messages starts at `0`: what was sent before they joined counts as read.

### GET /api/chat/:chatid

- Response `200`: `{ "chatRoom": ChatRoomDetail }`, the summary of `GET /api/chat` plus the requester's `role`.

### PATCH /api/chat/:chatid

Renames a group room and/or changes its avatar. Admin only, group rooms only.

```json
{ "name": "Updated project chat", "avatar_url": null }
```

- At least one of `name` and `avatar_url` (`400 At least either Name or Avatar must be provided`).
- `name` is a non-empty string of at most 100 characters after trimming (`400 'name' must be a non-empty string`, `400 'name' must be 100 characters or fewer`); `avatar_url` an `http:` or `https:` URL, or `null` to clear it (`400 'avatar_url' must be a string or null`, `400 'avatar_url' must be a valid URL`).
- Response `200`: `{ "chatRoom": ChatRoomCore }`: only the room's own columns, no `lastMessage`, `unreadCount` or `role`, so merge it into the cached room instead of replacing the summary.
- `403 Admin role required for this action`, `403 Not available for direct chat rooms`.

### DELETE /api/chat/:chatid

Deletes the room together with its messages and memberships. Admin only, group rooms only.

- Response `204`.
- `403`: as for `PATCH /api/chat/:chatid`.

### GET /api/chat/:chatid/member

The members of the room. Any member, direct or group.

- Response `200`: `{ "members": Member[] }`: admins first, then by name (case and accents ignored: `bea` comes before `Carl`). Every member is returned; there is no pagination.

### POST /api/chat/:chatid/member

Adds members. Admin only, group rooms only.

```json
{ "member_ids": [2, 3] }
```

- `member_ids` is required: a non-empty array of user ids (duplicates are ignored; `400` otherwise).
- New members get the role `member`. Users who are already members (the requester included) are skipped and left unchanged, so an existing admin is never demoted; their ids are returned in `alreadyMemberIds`.
- A new member starts with everything already in the room counted as read: `lastReadMessageId` is the room's newest message that is not deleted (`null` when it has none), so `unreadCount` is `0`. A user who left and is added again starts fresh.
- Response `201` when at least one member was added, `200` when everyone was already a member: `{ "addedMembers": Member[], "alreadyMemberIds": number[] }`.
- `403 Admin role required for this action`, `403 Not available for direct chat rooms`, `403 Only your friends can be added to a chat room` (nobody from that request is added).

### DELETE /api/chat/:chatid/member/:userid

Removes a member, or leaves the room when `:userid` is the requester's own id.

- Anyone can remove themself; removing someone else needs an admin, and in a direct room nobody can remove the other member.
- Response `204`.
- `400 Invalid user id`.
- `403 Admin role required for this action` (a non-admin removing someone else), `403 You can only remove yourself from a direct chat room`.
- `404 Member not found in this chat room` when the target is not a member.
- `409 The only admin cannot be removed while other members remain; promote another member to admin first`. This also stops a group's only admin from leaving while others remain. Direct rooms are exempt (both members are admins).
- When the last member leaves, the room is no longer reachable through the API and is deleted later together with its messages.

### PATCH /api/chat/:chatid/member/:userid

Changes a member's role. Admin only, group rooms only.

```json
{ "role": "admin" }
```

- `role` is `"admin"` or `"member"`; setting the role a member already holds is allowed and confirms it.
- Response `200`: `{ "member": Member }`.
- `400` for a bad `:userid` or `role`; `403 Admin role required for this action`, `403 Not available for direct chat rooms`; `404 Member not found in this chat room`.
- `409 The only admin cannot be demoted while other members remain; promote another member to admin first`.

### POST /api/chat/:chatid/message

Sends a message. Any member, direct or group.

```json
{ "content": "Hello!" }
```

- `content` is a non-empty string (whitespace-only is rejected), trimmed and at most 4000 characters.
- Response `201`: `{ "message": Message }`.
- `400` when `content` is missing, blank, not a string or too long.

### GET /api/chat/:chatid/message

The messages of the room, newest first. Any member, direct or group.

- Query: `before` (optional, a message id: only messages with a smaller id are returned, so for the next page pass the id of the oldest message already loaded) and `limit` (optional, 1 to 100, default 50). `400` when either is invalid.
- Response `200`: `{ "messages": Message[], "hasMore": boolean }`; `hasMore` is `true` when older messages remain beyond the page.
- A deleted message keeps its place in the list with `content: ""` and a non-null `deletedAt`. An edited one has `editedAt`. A message whose author deleted their account has `senderId` and `sender` set to `null`.

### PATCH /api/chat/:chatid/message/:message_id

Edits a message. Only its sender can, in direct and group rooms alike.

```json
{ "content": "Hello, world!" }
```

- `content` follows the rules of sending a message.
- A successful edit stamps `editedAt` and leaves `createdAt` alone, so the message keeps its place. Saving the content the message already has (after trimming) answers `200` with the message unchanged and no `editedAt`. There is no edit history and no time limit.
- Response `200`: `{ "message": Message }`.
- `400` for a bad `:message_id` or `content`; `403 You can only edit your own messages`; `404 Message not found in this chat room` when the message does not exist, belongs to another room, or was deleted (a deleted message cannot be edited back to life).

### DELETE /api/chat/:chatid/message/:message_id

Deletes a message for everyone in the room. Only its sender can.

- It is a soft delete: the message stays in `GET /api/chat/:chatid/message` with `content: ""` and `deletedAt` set, and it drops out of `lastMessage` and of everyone's `unreadCount`.
- Response `204`.
- `400` for a bad `:message_id`; `403 You can only delete your own messages`; `404 Message not found in this chat room` (does not exist, another room, or already deleted).

### PUT /api/chat/:chatid/read

Marks the room as read up to a message, for the requester only. Any member.

```json
{ "message_id": 42 }
```

- `message_id` is a JSON number: a positive integer (`400` otherwise).
- Response `200`: `{ "lastReadMessageId": 42 }`, the marker as it stands after the call.
- The marker only moves forward: a `message_id` at or below the current marker changes nothing and still answers `200`, so repeated or out-of-order calls (several tabs) are harmless. A soft-deleted message is a valid target. Other members' markers are never touched (they are what a "seen by" indicator is built from).
- `404 Message not found in this chat room` when no message with that id exists in this room.

## Friend endpoints

All of them require a session. `/api/friend/:id` takes a *user* id; every `/api/friend/requests/:id` route takes a *request* id. Every `:id` is a positive integer within the Postgres integer range.

### GET /api/friend/search/:tel

Looks up one user by phone number, so the requester can send them a friend request.

- `:tel` must be a full international number in the canonical spelling: `+` followed by at most 15 digits, no spaces, dashes, parentheses or extension (`400` otherwise). A client strips those from what was typed before calling, and encodes the segment with `encodeURIComponent` (`+` works as is in a path, both `/api/friend/search/+84912345678` and `/api/friend/search/%2B84912345678`). It is a path parameter on purpose: in a query string `+` would decode to a space.
- The match is exact, so the endpoint cannot be used to browse or list users.
- Response `200`: `{ "user": SearchResult }`, or `{ "user": null }` when nobody has that number (a normal outcome, not an error).
- `relationship` says which button to offer: `self`, `friend`, `request_sent`, `request_received` or `none`. For the two request states `requestId` is included, so the client can cancel or accept without another call. When more than one applies the first of `self`, `friend`, `request_received`, `request_sent` wins.
- `429 Too many searches, try again later`.

### POST /api/friend/requests

Sends a friend request.

```json
{ "receiver_id": 2 }
```

- Response `201`: `{ "request": FriendRequest }`, where `user` is the receiver.
- `400` when `receiver_id` is not a valid id, is the requester's own (`You cannot send a friend request to yourself`) or does not refer to an existing user (`receiver_id does not refer to an existing user`).
- `409 You are already friends with this user`; `409 You have already sent this user a friend request`; `409 This user has already sent you a friend request`, whose body also carries `requestId` of that request so the client can offer "Accept".
- `429 Too many friend requests, try again later`.

### GET /api/friend/requests

The requester's pending friend requests.

- Query `direction`: `incoming` (the default; requests others sent to the requester) or `outgoing` (requests the requester sent). Any other value, including an empty one, a different case or a repeated parameter, is `400 'direction' must be 'incoming' or 'outgoing'`.
- Response `200`: `{ "requests": FriendRequest[] }`, newest first (`user` is the other party: the sender for `incoming`, the receiver for `outgoing`). An empty list is `requests: []`. No pagination.

### POST /api/friend/requests/:id/accept

Accepts a friend request; `:id` is the request id. Only the receiver can.

- Response `201`: `{ "friend": PublicUser }`, the sender, who is now a friend. It does not create a room: the client calls `POST /api/chat` with `type: "direct"`, which reuses an existing one.
- `400 Invalid friend request id`; `404 Friend request not found` when the request does not exist or is not addressed to the requester (the two are not told apart), and when it was already accepted.

### DELETE /api/friend/requests/:id

Deletes a friend request; `:id` is the request id. Either party can: the receiver rejects, the sender cancels.

- Response `204`.
- `400 Invalid friend request id`; `404 Friend request not found` (does not exist, or the requester is neither its sender nor its receiver).
- Nobody is notified of a rejection and nothing is recorded: there is no "rejected" state and no block, so afterwards either user can send the other a new request.

### GET /api/friend

The requester's friends.

- Response `200`: `{ "friends": PublicUser[] }`, sorted by name (case-insensitive). An empty list is `friends: []`. No pagination.

### DELETE /api/friend/:id

Unfriends a user; `:id` is a *user* id. Either friend can call it, and both sides of the friendship go.

- Response `204`.
- `400 Invalid user id`; `404 You are not friends with this user` (also for a user that does not exist, so ids cannot be probed).
- Existing direct rooms between the two keep working; see "Friendship requirement". Pending friend requests are not touched (a pair that are friends has none), so afterwards either user can send the other a new request.

## Rate limits

Every request that reaches a limiter counts, including the ones answered `400` or `409`. A limit that is per user is checked after the session, so a request without a session is a `401` and does not count.

| Endpoint | Limit | `429` text |
| --- | --- | --- |
| `POST /api/account/login` | 10 per 15 minutes per IP | `Too many attempts, try again later` |
| `POST /api/account/password`, `DELETE /api/account/me` | 10 per 15 minutes per user, one budget shared by the two | `Too many attempts, try again later` |
| `POST /api/account/email/verify` | 10 per 15 minutes per IP | `Too many attempts, try again later` |
| `POST /api/account/email/verification` | 5 per hour per user, and a pause while the last link is under 60 seconds old | `Too many verification emails requested, try again later`; `Please wait a minute before asking for another email` |
| `POST /api/account/password/reset-request` | 10 per 15 minutes per IP, and 3 per hour per email address | `Too many attempts, try again later`; `Too many password reset requests, try again later` |
| `POST /api/account/password/reset` | 10 per 15 minutes per IP | `Too many attempts, try again later` |
| `GET /api/friend/search/:tel` | 30 per 15 minutes per user | `Too many searches, try again later` |
| `POST /api/friend/requests` | 20 per hour per user | `Too many friend requests, try again later` |

The other endpoints have no limiter.

## Real-time events (planned)

Not built yet: the server side and the client are written together (step 6 of `./frontend.doc.md`). The socket is a notification layer on top of the REST endpoints: it never writes data, and every event has the same effect as refetching the matching endpoint.

- The handshake uses the session cookie, and a connection without a valid session is refused. In development the browser reaches Socket.io through the dev proxy (`/socket.io`).
- A socket joins `user:<id>` (friend events, being added to a room) and `chat:<chatId>` for every room the user is a member of. Leaving, being removed or a deleted room takes the sockets out of `chat:<chatId>`, so a removed member stops receiving that room.
- Events: `message:new`, `message:updated`, `message:deleted`, `chat:updated`, `chat:removed`, `member:added`, `member:removed`, `member:role_changed`, `read:updated`, `friend:request`, `friend:accepted`. `message:updated` carries the same message as the `PATCH` response, and `message:deleted` is `{ chatId, messageId, deletedAt }`. The other payloads are fixed in step 6 and written here then.
- Typing indicators are socket-only and never stored.
