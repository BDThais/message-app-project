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

## Test database setup

Backend integration tests use a separate PostgreSQL database provided by
`server/docker-compose.test.yml`. Copy `server/.env.test.example` to
`server/.env.test` once, then run `npm test` from `server/`. The test command
starts the container, deploys the existing Prisma migrations, and cleans test
records between cases. It does not use the development database configured in
`server/.env`.

## Current Implementation Status

The backend is now at a broader API MVP than the original plan. The active implementation includes the account lifecycle and the room-management layer required for chat features:

Completed:

- POST /account/signup
- POST /account/login
- GET /account/me
- POST /account/logout
- POST /chatrooms
- GET /chatrooms
- GET /chatrooms/:chatid
- PATCH /chatrooms/:chatid
- DELETE /chatrooms/:chatid
- Chat membership validation and admin/role enforcement
- Direct-room reuse and group-room creation flows
- Basic room summaries with latest-message metadata

Still planned or not yet implemented:

- Message sending and reading APIs for chat rooms
- Friend search and friend request flows
- Friendship management and acceptance/rejection
- Real-time socket communication
- Frontend application screens and state management
- Production deployment hardening

The room and auth systems are now acting as the current working backend foundation. Friend and realtime features remain future work and should be treated as the next milestone rather than as missing pieces of the current baseline.

Note: In the database, the mutual friendship model stores two rows per friendship pair, one for each user, as described in the project requirements.

## Permission model

Action                     admin  member
Send / read messages         ✅     ✅
Update room name/avatar      ✅     ❌
Delete room                  ✅     ❌
Add members                  ✅     ❌
Remove other members         ✅     ❌
Leave the room               ✅     ✅
Promote/demote a member      ✅     ❌

## API Status

### Auth endpoints (implemented)

POST /account/signup

- Creates a new user account
- Validates name, email, tel, and password
- Checks for duplicate email or phone number
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

- return body:

  ```json
  {
    "message": "Account created successfully"
  }
  ```

POST /account/login

- Validates the supplied email/password
- Returns a generic invalid credentials message for both failed user and password checks
- Destroys any stale session for the same user
- Creates a new session and sets the session cookie
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

POST /chatrooms (implemented)

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

GET /chatrooms (implemented)

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

GET /chatrooms/:chatid (implemented)

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

PATCH /chatrooms/:chatid (implemented)

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

DELETE /chatrooms/:chatid (implemented)

- delete the room; cascades to its messages and memberships automatically
- only valid for type: group rooms
- requires admin
- no response body (`204 No Content`)

POST /chatrooms/:chatid/members

- add one or many existing user to the room
- only valid for type: group rooms
- requires admin
- body: { member_ids }
- new members are inserted with role: member

DELETE /chatrooms/:chatid/members/:userid

- remove a member from the room (delete their ChatMember record)
- a user can always remove themself (leave); removing someone else requires admin
- if the chat room is of type "direct", don't let them remove any member other than themself even if they're admin
- reject with 409 if the target is the room's only remaining admin and other members are still present (basically speaking, the group room admin can't remove themself if they're the only admin in the group room). This rule doesn't apply to direct room since direct room only have 2 members and both are admins
- if there are less than 1 member in the room after a removal (usually mean that the last member is an admin and they remove themself), then that mean there are no longer any ChatMember record that linked to this ChatRoom record and the ChatRoom record will be deleted after a set period of time along with it's messages.  

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

The repository contains a frontend workspace and a TypeScript/Express server with Prisma persistence, authentication, and the current chat-room backend implementation.
Generated files created by tools such as Prisma are omitted from this structure, while the source-controlled Prisma schema remains documented.
All database operations are kept in the `/services` folder.

message-app/
├── frontend/                   // Empty frontend workspace
├── server/
│   ├── package.json
│   ├── prisma.config.ts
│   ├── tsconfig.json
│   ├── prisma/
│   │   ├── schema.prisma
│   │   └── migrations/         // Database migration history
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
│   │   │   └── prisma.ts
│   │   ├── middlewares/
│   │   │   ├── ChatRoomAuth.ts
│   │   │   ├── ErrorHandler.ts
│   │   │   ├── RateLimiter.ts
│   │   │   └── UserSessionAuth.ts
│   │   ├── routes/
│   │   │   ├── AccountRoutes.ts
│   │   │   └── ChatRoomRoutes.ts
│   │   └── services/
│   │       ├── AccountServices.ts
│   │       ├── ChatMemberServices.ts
│   │       ├── ChatRoomServices.ts
│   │       └── SessionServices.ts
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

## Backend Data Flow

The backend follows a layered request flow:

1.**Request parsing and routing**

- Express receives the request and parses JSON bodies with `express.json()`.
- `cookie-parser` makes the session cookie available through `req.cookies`.
- The request is sent to the matching route under `/account` or `/chatrooms`.

2.**Authentication**

- Account signup and login validate the incoming body in their controllers before calling the account services.
- Login verifies the password, removes any stale session for the user, creates a new session, and sends the session cookie in the response.
- Protected chat-room routes run `requireUserAuth`, which reads the session cookie, loads the user through `SessionServices`, and attaches the authenticated user to `req.user`.
- `/account/me` uses the same session lookup but returns `user: null` when no valid session exists. Logout deletes the session when present and clears the cookie.

3.**Route-level authorization**

- For routes containing `:chatid`, `loadChatMembership` checks the authenticated user's membership and the room type in one Prisma query.
- A valid membership is attached to `req.chatMembership` with the room ID, role, and room type.
- `requireGroupRoom` restricts group-only actions, while `requireChatAdmin` restricts administrative actions. Requests that fail these checks end before reaching the controller.

4.**Validation and controller handling**

- Controllers validate request bodies and URL parameters, then pass normalized values to the relevant service.
- Controllers coordinate the HTTP response: they choose the status code, select the response shape, and pass unexpected errors to the shared error handler.

5.**Service and database flow**

- Services contain all database operations and use the shared Prisma client from `src/lib/prisma`.
- Account services create and find users. Session services create, read, and delete sessions.
- Chat-room services create rooms and memberships in a Prisma transaction, load direct and group rooms, retrieve the latest message for room summaries, and update or delete rooms.
- Direct-room responses derive the room name and avatar from the other member; group-room responses use the room's own name and avatar fields.

6.**Response and error flow**

- Successful service results are mapped to JSON responses by the controller and returned to the client.
- Validation and authorization failures return directly from the relevant controller or middleware with an appropriate `4xx` status.
- Unexpected service or Prisma errors are forwarded with `next(error)` and handled by the application's final error-handler middleware.

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

1. Complete message creation and retrieval APIs for direct and group rooms
2. Add friend list and request flows with membership enforcement
3. Implement real-time communication with Socket.io
4. Build the React frontend and integrate with TanStack Query
5. Add authentication-aware UI states and protected routes
6. Add deployment configuration and production hardening

## Notes

This document reflects the current state of the repository. The auth module and the core chat-room backend are in place and working;
the remaining messaging feature set is planned as incremental extension work for the app.
