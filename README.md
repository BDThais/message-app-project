# Message App

A TypeScript full-stack messaging application with an Express API, PostgreSQL database, Prisma ORM, and a React frontend (scaffolded, screens in progress). The REST API is in place (accounts with email verification and password reset, chat rooms, messages and the friend flows), while real-time messaging and the frontend screens remain next on the roadmap.

## Project Status

The server's REST API is in place and the frontend is the current milestone. Implemented features include:

- User signup with validation and duplicate checks
- Password hashing and credential verification
- Login, logout, and session cookie handling
- Authenticated user lookup via session middleware
- Email verification: a link is mailed at signup and on request, and the user carries `emailVerified`
- Password reset by email: a signed-out user asks for a link and sets a new password with it; only verified addresses get a link
- Protected route middleware for chat access
- Direct and group chat room creation, listing, update, and deletion
- Chat membership and role checks with admin-only protections
- Room summaries with the latest message and the unread count
- Messages: send, list with pagination, edit, delete, and a read marker per member
- Friends: search by phone number, friend requests (send, list, accept, reject, cancel), the friend list and unfriending; friendship is required to start a conversation
- Profile update, password change and account deletion
- Prisma models for users, sessions, chat rooms, messages, and friendship flows
- Vitest integration tests for the account, chat-room, message and friend endpoints
- React frontend scaffold in `frontend/`: Vite dev server that proxies `/api` to the server, route guards for signed-in and signed-out pages, and a sign-in page (the plan and the next steps are in `frontend.doc.md`)

Next priorities:

- Real-time communication with Socket.io, built together with the frontend
- Frontend screens and auth-aware user flows (the steps are in `frontend.doc.md`)
- Production deployment and environment hardening

## Tech Stack

- Backend: Express.js + TypeScript
- Database: PostgreSQL + Prisma ORM
- Authentication: session cookies with protected middleware
- Testing: Vitest + Supertest
- Email: Resend behind a replaceable `Mailer` (mails are only printed to the server log unless `MAIL_TRANSPORT=resend`)
- Frontend: React + TypeScript + Vite (scaffolded; see `frontend.doc.md`)
- Routing and data fetching: TanStack Router and TanStack Query
- Real-time communication: Socket.io planned

## Repository Layout

- Root project files: README.md, api.doc.md (the API specification), backend.doc.md (server plan and implementation notes), frontend.doc.md (frontend plan)
- Frontend workspace: frontend/ (plan and conventions: frontend.doc.md)
- Backend server: server/
- App entry point: server/src/app.ts
- Feature modules (routes, controllers, services, validators per feature): server/src/modules/
- Middleware shared by several features: server/src/middlewares/
- Prisma schema and migrations: server/prisma/

## API

Every endpoint is served under the `/api` prefix. The tables below only list what exists. The request and response of each endpoint, its status codes, error texts, rate limits and who may call it are specified in [`api.doc.md`](./api.doc.md), the one place to read them and to change them.

The endpoints marked public need no session; every other endpoint answers `401` without one.

### Account endpoints

| Endpoint | What it does |
| --- | --- |
| `POST /api/account/signup` | Create an account (public; it does not sign the user in) |
| `POST /api/account/login` | Sign in and set the session cookie (public) |
| `GET /api/account/me` | The current user, or `null` without a session (public) |
| `POST /api/account/logout` | Delete the session and clear the cookie (public) |
| `PATCH /api/account/me` | Update your name and/or avatar |
| `POST /api/account/password` | Change your password (your other sessions are signed out) |
| `DELETE /api/account/me` | Delete your account |
| `POST /api/account/email/verify` | Confirm an email address with the token from a mail (public) |
| `POST /api/account/email/verification` | Mail a new verification link |
| `POST /api/account/password/reset-request` | Ask for a password reset link (public) |
| `POST /api/account/password/reset` | Set a new password with the token from a reset mail (public) |

### Chatroom endpoints

| Endpoint | What it does |
| --- | --- |
| `POST /api/chat` | Create a room, or reuse the direct room between two users |
| `GET /api/chat` | List your rooms, with the latest message and the unread count |
| `GET /api/chat/:chatid` | One room, with your role |
| `PATCH /api/chat/:chatid` | Rename a group room or change its avatar (admin) |
| `DELETE /api/chat/:chatid` | Delete a group room with its messages (admin) |
| `GET /api/chat/:chatid/member` | List the members of a room |
| `POST /api/chat/:chatid/member` | Add members to a group room (admin) |
| `DELETE /api/chat/:chatid/member/:userid` | Remove a member, or leave the room |
| `PATCH /api/chat/:chatid/member/:userid` | Change a member's role (admin) |
| `POST /api/chat/:chatid/message` | Send a message |
| `GET /api/chat/:chatid/message` | List the messages of a room, newest first |
| `PATCH /api/chat/:chatid/message/:message_id` | Edit your message |
| `DELETE /api/chat/:chatid/message/:message_id` | Delete your message |
| `PUT /api/chat/:chatid/read` | Mark the room as read |

### Friend endpoints

| Endpoint | What it does |
| --- | --- |
| `GET /api/friend/search/:tel` | Find a user by phone number |
| `POST /api/friend/requests` | Send a friend request |
| `GET /api/friend/requests` | List your pending friend requests |
| `POST /api/friend/requests/:id/accept` | Accept a friend request |
| `DELETE /api/friend/requests/:id` | Reject or cancel a friend request |
| `GET /api/friend` | List your friends |
| `DELETE /api/friend/:id` | Unfriend a user |

## Database Model

The Prisma schema includes the core relational models needed for a messaging app:

- User
- Session
- EmailVerificationToken
- PasswordResetToken
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

The tests never send a mail. To try a real delivery through Resend, put `MAIL_TRANSPORT=resend`, `RESEND_API_KEY` and `MAIL_FROM` in `server/.env`, start the server with `npm run dev`, and run `npm run try:email -- <address>` in a second terminal; it walks through email verification and password reset and asks you to paste the link from each mail. Until a domain is verified in Resend, the address has to be the Resend account's own.

The test connections run in the `Asia/Ho_Chi_Minh` time zone, whatever the database server is set to, so code that depends on the database clock instead of the application's fails in the tests (see `backend.doc.md`, "Test database setup").

## Running the frontend

Start the server first (`npm run dev` in `server/`, port 3000), then from `frontend/`:

```powershell
npm install
npm run dev
```

Open `http://localhost:5173`. The dev server forwards requests that start with `/api` to the server, so no CORS setup is needed and the session cookie works as it will in production. The port is fixed because the server's verification and password reset mails link to `http://localhost:5173/...`; if something else uses it, `npm run dev` stops instead of moving to another port.

`npm test` in `frontend/` runs the frontend tests (Vitest; no server and no database needed). `API_PROXY_TARGET` in `frontend/.env` changes where `/api` is forwarded to (see `frontend/.env.example`).

## Roadmap

- Add Socket.io for realtime messaging (server and client together)
- Build the React frontend step by step (scaffold and route guards done; account screens, chat, friends and room management next)
- Add deployment and environment configuration for production

## License

This project is currently for personal and development use unless a separate license is added later.
