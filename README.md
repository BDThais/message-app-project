# Message App

A TypeScript full-stack messaging application with an Express API, PostgreSQL database, Prisma ORM, and a planned React frontend. The current codebase is focused on the backend account/session foundation, with chat and friendship features still to be implemented.

## Project Status

The project is in active backend development. The implemented foundation includes:

- User signup with validation
- Duplicate email and phone detection
- Password hashing
- Login with credential validation
- Session creation and cookie-based authentication
- Fetching the current authenticated user via session cookie
- Logout and session cleanup
- Protected route middleware scaffolding for future chat APIs
- Prisma schema for users, sessions, chat rooms, messages, friend requests, and friend lists
- API tests covering the account/session flow

Not implemented yet:

- Real chat room creation and listing
- Message sending and retrieval APIs
- Friend search and request handling
- Real-time messaging with Socket.io
- Frontend application and auth-aware UI
- Production deployment hardening

## Tech Stack

- Backend: Express.js + TypeScript
- Database: PostgreSQL + Prisma ORM
- Authentication: server-side session cookies
- Testing: Vitest + Supertest
- Frontend: React planned
- Data fetching: TanStack Query planned
- Real-time communication: Socket.io planned

## Backend Structure

The server package contains the current implementation:

- App entry point: server/src/app.ts
- Account routes: server/src/routes/AccountRoutes.ts
- Chat route skeleton: server/src/routes/ChatRoomRoutes.ts
- Controllers: server/src/controllers/
- Middleware: server/src/middlewares/
- Prisma schema and client: server/prisma/

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

Request body:
```json
{
  "email": "john@example.com",
  "password": "Str0ng!Pass"
}
```

Response:
```json
{
  "user": {
    "id": 1,
    "name": "John Doe",
    "email": "john@example.com",
    "tel": "+1234567890"
  }
}
```

#### GET /account/me
Returns the current authenticated user or null when no valid session exists.

Response:
```json
{
  "user": {
    "id": 1,
    "name": "John Doe",
    "email": "john@example.com",
    "tel": "+1234567890"
  }
}
```

#### POST /account/logout
Deletes the active session and clears the auth cookie.

Response:
```json
{
  "user": null
}
```

### Chat route skeleton

The chat routes are mounted under /chatrooms and protected by auth middleware, but the actual chat functionality is still a placeholder:

- GET /chatrooms/
- POST /chatrooms/
- GET /chatrooms/:chatid/messages
- POST /chatrooms/:chatid/messages

These endpoints currently exist as route stubs and are not yet implemented.

## Database Model

The Prisma schema includes the core relational models needed for a messaging app:

- User
- Session
- ChatRoom
- ChatMember
- Message
- PendingFriendRequest
- FriendListMember

The schema is in place, but the business logic for chat and friendship flows still needs to be built on top of it.

## Testing

The backend has Vitest + Supertest coverage for the auth/user flow, including:

- successful signup
- invalid input validation
- duplicate email/phone checks
- login success and failure
- session retrieval and logout behavior
- unexpected error handling

## Roadmap

- Build chat room creation and membership APIs
- Implement direct and group message flows
- Add friend lookup and pending request handling
- Add real-time communication with Socket.io
- Create the React frontend and protected auth pages
- Add deployment/environment configuration for production

## License

This project is currently for personal and development use unless a separate license is added later.