# Message App

A TypeScript full-stack messaging application with an Express API, PostgreSQL database, Prisma ORM, and a planned React frontend. The backend has moved beyond the initial auth baseline and now includes the core chat-room foundation, while friend requests and real-time messaging remain next on the roadmap.

## Project Status

The application is currently in an active backend MVP phase. Implemented features include:

- User signup with validation and duplicate checks
- Password hashing and credential verification
- Login, logout, and session cookie handling
- Authenticated user lookup via session middleware
- Email verification: a link is mailed at signup and on request, and the user carries `emailVerified`
- Protected route middleware for chat access
- Direct and group chat room creation, listing, update, and deletion
- Chat membership and role checks with admin-only protections
- Room summaries with the latest message and the unread count
- Prisma models for users, sessions, chat rooms, messages, and friendship flows
- Vitest integration tests for the account/session flow

Next priorities:

- Friend search, requests, and friendship management
- Direct and group messaging APIs and pagination
- Real-time communication with Socket.io
- Frontend screens and auth-aware user flows
- Production deployment and environment hardening

## Tech Stack

- Backend: Express.js + TypeScript
- Database: PostgreSQL + Prisma ORM
- Authentication: session cookies with protected middleware
- Testing: Vitest + Supertest
- Email: Resend behind a replaceable `Mailer` (mails are only printed to the server log unless `MAIL_TRANSPORT=resend`)
- Frontend: React planned
- Data fetching: TanStack Query planned
- Real-time communication: Socket.io planned

## Repository Layout

- Root project files: project-planning-doc.md, README.md
- Frontend workspace: frontend/
- Backend server: server/
- App entry point: server/src/app.ts
- Feature modules (routes, controllers, services, validators per feature): server/src/modules/
- Middleware shared by several features: server/src/middlewares/
- Prisma schema and migrations: server/prisma/

## API

### Account endpoints

#### POST /account/signup

Creates a new user account.

Request body:

```json
{
  "name": "John Doe",
  "email": "john@example.com",
  "password": "Str0ng!Pass",
  "tel": "+1234567890"
}
```

Response:

```json
{
  "message": "Account created successfully"
}
```

`tel` must be a valid phone number with its country code. It is stored in canonical E.164 form (`+` and digits only), so `+1 (415) 555-2671` is saved as `+14155552671`, and registering the same number in another spelling answers `409`. Error responses across the API have the shape `{ "error": "..." }`.

After answering `201`, signup mails a verification link to the new address (see `POST /account/email/verify`). The account starts unverified, signup does not sign the user in, and a mail that cannot be sent does not fail the signup.

#### POST /account/login

Authenticates a user and sets a session cookie. The returned `user` is `{ id, name, email, tel, avatarUrl, emailVerified }`; the same shape comes back from `GET /account/me` and `PATCH /account/me`.

#### GET /account/me

Returns the current authenticated user or null when no valid session exists.

#### POST /account/logout

Deletes the active session and clears the auth cookie.

#### PATCH /account/me

Updates the signed-in user's `name` and/or `avatar_url` (`null` clears the avatar) and returns the updated `{ user }`, which now includes `avatarUrl`.

#### POST /account/password

Changes the signed-in user's password. Body: `{ "current_password": "...", "new_password": "..." }`. Answers `204`, signs the account out of every other session, and answers `401` when the current password is wrong.

#### DELETE /account/me

Deletes the signed-in user's account. Body: `{ "password": "..." }`. Answers `204` and clears the session cookie; the user's sessions, memberships, friendships and friend requests go with the account, while their messages stay in the rooms without a sender. Answers `401` when the password is wrong and `409` (with the room ids in `chatIds`) while the user is the only admin of a group room that still has other members.

#### POST /account/email/verify

Confirms an email address with the token from a verification mail. No session is needed. Body: `{ "token": "..." }`. Answers `204`, or `400` when the token is unknown, already used, expired, replaced by a newer link, or was issued for an address the account no longer has (one message for all of them). A link works once. Limited to 10 requests per 15 minutes per IP.

The mailed link is `EMAIL_VERIFICATION_URL#token=...`: the token is in the URL fragment, so the frontend page reads it and sends it to this endpoint as a `POST`. Links work for `EMAIL_VERIFICATION_TTL_MS` (24 hours by default). `EMAIL_VERIFICATION_URL` defaults to `http://localhost:5173/verify-email` outside production and must be set in production; both settings are checked when the server starts. Without `MAIL_TRANSPORT=resend` the mail is printed to the server log, so the token can be copied from there.

#### POST /account/email/verification

Mails a new verification link to the signed-in user's address and replaces the old one. Answers `204`, `409` when the address is already verified, and `429` while the last link is younger than a minute. Limited to 5 requests per hour per user. This is also how accounts created before email verification get verified.

### Chatroom endpoints

The protected chat routes are implemented on the server and include:

- POST /chat
- GET /chat
- GET /chat/:chatid
- PATCH /chat/:chatid
- DELETE /chat/:chatid
- Room membership logic for direct and group rooms
- Admin-only room management controls

The remaining work is focused on friend flows and realtime messaging rather than the core room infrastructure itself.

## Database Model

The Prisma schema includes the core relational models needed for a messaging app:

- User
- Session
- EmailVerificationToken
- ChatRoom
- ChatMember
- Message
- PendingFriendRequest
- FriendListMember

## Testing

The backend uses Vitest + Supertest with an isolated PostgreSQL database managed by Docker Compose for integration tests.

From the server folder, create the local test environment once:

```powershell
Copy-Item .env.test.example .env.test
```

Run the tests:

```powershell
npm test
```

The test setup brings up the `chatapp_test` container, applies Prisma migrations, and clears records between runs.

The test connections run in the `Asia/Ho_Chi_Minh` time zone, whatever the database server is set to, so code that depends on the database clock instead of the application's fails in the tests (see `project-planning-doc.md`, "Test database setup").

## Roadmap

- Finish friend lookup and pending request flows
- Implement message creation and retrieval APIs
- Add Socket.io for realtime messaging
- Build the React frontend and protected auth screens
- Add deployment and environment configuration for production

## License

This project is currently for personal and development use unless a separate license is added later.
