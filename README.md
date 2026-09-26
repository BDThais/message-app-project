# Message App

A TypeScript full-stack messaging application with an Express API, PostgreSQL database, Prisma ORM, and a planned React frontend. The backend has moved beyond the initial auth baseline and now includes the core chat-room foundation, while friend requests and real-time messaging remain next on the roadmap.

## Project Status

The application is currently in an active backend MVP phase. Implemented features include:

- User signup with validation and duplicate checks
- Password hashing and credential verification
- Login, logout, and session cookie handling
- Authenticated user lookup via session middleware
- Protected route middleware for chat access
- Direct and group chat room creation, listing, update, and deletion
- Chat membership and role checks with admin-only protections
- Room summary and latest-message aggregation
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

#### POST /account/login

Authenticates a user and sets a session cookie.

#### GET /account/me

Returns the current authenticated user or null when no valid session exists.

#### POST /account/logout

Deletes the active session and clears the auth cookie.

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

## Roadmap

- Finish friend lookup and pending request flows
- Implement message creation and retrieval APIs
- Add Socket.io for realtime messaging
- Build the React frontend and protected auth screens
- Add deployment and environment configuration for production

## License

This project is currently for personal and development use unless a separate license is added later.
