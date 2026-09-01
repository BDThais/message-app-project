# Message App Project Planning & Progress

## Overview
This project is a real-time messaging application built with PostgreSQL, Prisma, TypeScript, Express.js, and a React frontend. The backend is currently in a working MVP state for account authentication and session management.

## Tech Stack
- PostgreSQL
- Prisma ORM
- TypeScript
- Express.js
- React
- TanStack Query
- Socket.io
- TanStack Router

## Current Implementation Status
The project is not yet at full messaging feature parity. The backend currently includes the core account lifecycle endpoints that are required for authentication and session handling:

Completed:
- POST /account/signup
- POST /account/login
- GET /account/me
- POST /account/logout

Not implemented yet:
- Chat room listing and creation
- Message retrieval and sending
- Friend search and friend request flows
- Friendship management and request acceptance/rejection
- Real-time socket communication
- Frontend application screens and state management

These unimplemented features remain part of the planned roadmap and should be treated as future work rather than current API behavior.

## Target Database Schema
The database design reflects the planned messaging app architecture.

User:
- id PK
- name
- email
- password_hash
- tel

Session:
- id PK
- userId FKEY User(id)
- expires_at

ChatRoom:
- id PK
- name
- type CHECK ('direct' or 'group')

ChatMember:
- member_id PK FKEY User(id)
- chat_id PK FKEY ChatRoom(id)
- last_read_message_id FKEY Message(id) NULLABLE

Message:
- id PK
- chat_id FKEY ChatRoom(id)
- sender FKEY User(id)
- created_at
- content

PendingFriendRequest:
- id PK
- sender_id FKEY User(id)
- receiver_id FKEY User(id)
- UNIQUE (sender_id, receiver_id)

FriendListMember:
- id PK FKEY User(id)
- friendId PK FKEY User(id)

Note: the mutual friendship model stores two rows per friendship pair, one for each user, as described in the project requirements.

## Permission model
Action	                    admin  member
Send / read messages	     ✅     ✅
Update room name/avatar	     ✅	   ❌
Delete room	                 ✅	   ❌
Add members	                 ✅	   ❌
Remove other members	     ✅	   ❌
Leave the room	             ✅	   ✅
Promote/demote a member	     ✅	   ❌

## API Status
### Auth endpoints (implemented)
POST /account/signup
- Creates a new user account
- Validates name, email, tel, and password
- Checks for duplicate email or phone number
- Hashes the password before saving

POST /account/login
- Validates the supplied email/password
- Returns a generic invalid credentials message for both failed user and password checks
- Destroys any stale session for the same user
- Creates a new session and sets the session cookie

GET /account/me
- Returns the current authenticated user or null if there is no session

POST /account/logout
- Invalidates the current session if it exists
- Clears the session cookie
- Returns the user as null

### Planned future endpoints
POST /chatrooms
- create a new chat room
- body: type, member_ids, name?

GET /chatrooms
- retrieve a list of all the chat rooms that have this user as its member

GET /chatrooms/:chatid
- retrieve data about a specific room

PATCH /chatrooms/:chatid
- update the room's name and/or avatar_url
- only valid for type: group rooms
- requires the requester to hold admin in this room
- body: { name?, avatar_url? }

DELETE /chatrooms/:chatid
- delete the room; cascades to its messages and memberships automatically
- only valid for type: group rooms
- requires admin

POST /chatrooms/:chatid/members
- add one existing user to the room
- only valid for type: group rooms
- requires admin
- body: { member_id }
- new member are inserted with role: member

DELETE /chatrooms/:chatid/members/:userid
- remove a member from the room
- a user can always remove themself (leave); removing someone else requires admin
- only valid for type: group rooms
- reject with 409 if the target is the room's only remaining admin and other members are still present, otherwise the room becomes unmanageable
- if there are less than 1 member in the room after a removal, delete the chat room

PATCH /chatrooms/:chatid/members/:userid
- change a member's role
- requires admin
- body: { role: 'admin' | 'member' }

GET /chatrooms/:chatid/messages?before=<message_id>&limit=50
- retrieve all messages of that chat room
- support pagination by loading messages before a given message ID

POST /chatrooms/:chatid/messages
- post a new message to the database
- validate that the user is a member of the chat room before sending

GET /friend/search/:tel
- search users by phone number to find someone to send a friend request to

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
The repository is organized so that generated Prisma artifacts are not treated as source code and are excluded from the documented structure.

message-app/
├── frontend/                   // React frontend workspace (currently empty / planned)
├── server/
│   ├── package.json            // Server dependencies and scripts
│   ├── tsconfig.json           // TypeScript configuration
│   ├── prisma.config.ts        // Prisma client configuration
│   ├── .env                    // Local environment variables
│   ├── prisma/
│   │   └── schema.prisma       // Prisma schema definition
│   ├── src/
│   │   ├── app.ts              // Express app setup and route registration
│   │   ├── server.ts           // App bootstrap and server startup
│   │   ├── config/
│   │   │   └── config.ts       // Env configuration loader
│   │   ├── controllers/
│   │   │   ├── AccountControllers.ts
│   │   │   ├── LoginValidator.ts
│   │   │   └── SignUpFormValidators.ts
│   │   ├── lib/
│   │   │   ├── passwordHash.ts
│   │   │   ├── prisma.ts
│   │   │   └── session.ts
│   │   ├── routes/
│   │   │   ├── AccountRoutes.ts
│   │   │   └── ChatRoomRoutes.ts
│   │   └── generated/         // Reserved for generated Prisma artifacts, not tracked as source code
│   └── test/
│       ├── account-login-me-logout.http
│       ├── account-signup.http
│       ├── AccountSessionController.test.ts
│       └── AccountSignupController.test.ts
├── .gitignore
├── project-planning-doc.md
└── README.md

## Cookie / CORS Notes
When sending cookies from a frontend, the server must allow credentials and the frontend origin must be explicitly allowed.

Example Express setup:
```ts
app.use(cors({ origin: 'http://localhost:5173', credentials: true }));
```

Example frontend fetch:
```ts
fetch('http://localhost:3000/account/me', { credentials: 'include' });
```

## Roadmap
1. Complete chat room and message APIs
2. Add friend list and request flows
3. Implement real-time communication with Socket.io
4. Build the React frontend and integrate with TanStack Query
5. Add authentication-aware UI states and protected routes
6. Add deployment configuration and production hardening

## Notes
This document reflects the current state of the repository. The auth module is complete and working; the rest of the messaging feature set is a planned extension of the app and should be implemented incrementally.