# Message App Project Planning & Progress

## Overview
This project is a real-time messaging application built with PostgreSQL, Prisma, TypeScript, Express.js, and a React frontend. 
The backend is currently in a working MVP state for account authentication and session management.

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

Note: In the database, the mutual friendship model stores two rows per friendship pair, one for each user, as described in the project requirements.

## Permission model
Action	                    admin  member
Send / read messages	       ✅     ✅
Update room name/avatar	     ✅	   ❌
Delete room	                 ✅	   ❌
Add members	                 ✅	   ❌
Remove other members	       ✅	   ❌
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
All of these endpoints are routed after auth middleware so they can access user's data with req.user.
req.user shape = {
  id: number;
  name: string;
  email: string;
  tel: string;
}
A direct room has no name/avatar to edit, it's members also can't add or remove the other member from the room, all of it's members are admins.
Endpoints that required authorization to access have to be routed after the auth middlewares

POST /chatrooms (implemented | untested)
- create a new chat room
- body: type, member_ids, name?, avatar_url?

GET /chatrooms (implemented | untested)
- retrieve a list of all the chat rooms that have this user as its member
- have separate functions for retrieving direct and group chat room, the functions return all direct/group chat rooms that has req.user 
  as member (with datas of the last message in that room like it's content, time created) when it's not supplied with a specific chatid. 
  The function responsible for retrieving direct chat room return the other user'name as the room's name and use their avatar url (if it's not null) 
  as the room's avatar url
- the success response return the chat rooms sorted by how recent is the last message, the rooms that doesn't have last message is sorted by time created

GET /chatrooms/:chatid (implemented | untested)
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
- add one or many existing user to the room
- only valid for type: group rooms
- requires admin
- body: { member_ids }
- new members are inserted with role: member

DELETE /chatrooms/:chatid/members/:userid
- remove a member from the room
- a user can always remove themself (leave); removing someone else requires admin
- if the chat room is of type "direct", don't let them remove any member other than themself even if they're admin
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
The repository currently contains an empty frontend workspace and a TypeScript/Express server with Prisma persistence, authentication, and initial chat-room support.
Generated files created by tools such as Prisma are omitted from this structure, while source-controlled Prisma schema remain documented.

message-app/
├── frontend/                   // Empty frontend workspace
├── server/
│   ├── package.json
│   ├── prisma.config.ts
│   ├── tsconfig.json
│   ├── prisma/
│   │   ├── schema.prisma
│   │   └── migrations/
│   ├── src/
│   │   ├── app.ts
│   │   ├── server.ts
│   │   ├── config/
│   │   │   └── config.ts
│   │   ├── controllers/
│   │   │   ├── AccountControllers.ts
│   │   │   ├── ChatRoomControllers.ts
│   │   │   ├── ChatRoomValidators.ts
│   │   │   ├── LoginValidator.ts
│   │   │   └── SignUpFormValidators.ts
│   │   ├── lib/
│   │   │   ├── passwordHash.ts
│   │   │   ├── prisma.ts
│   │   │   └── session.ts
│   │   ├── middlewares/
│   │   │   ├── ChatRoomAuth.ts
│   │   │   ├── ErrorHandler.ts
│   │   │   ├── RateLimiter.ts
│   │   │   └── UserSessionAuth.ts
│   │   ├── routes/
│   │   │   ├── AccountRoutes.ts
│   │   │   └── ChatRoomRoutes.ts
│   │   └── services/
│   │       └── ChatRoomServices.ts
│   └── test/
│       ├── account-login-me-logout.http
│       ├── account-signup.http
│       ├── AccountSessionController.test.ts
│       └── AccountSignupController.test.ts
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
This document reflects the current state of the repository. The auth module is complete and working; 
the rest of the messaging feature set is a planned extension of the app and should be implemented incrementally.