Tools:
    Postgresql
    Prisma
    Typescript
    Express.js
    React
    Tanstack Query
    Socket.io
    Tanstack Router
    ...

Database tables:

    User:
        id PK
        name    //only accept alphanumeric characters
        email
        password_hash
        tel

    Session:
        id PK
        userId FKEY User(id)
        expires_at

    ChatRoom:
        id PK
        name
        type CHECK ('direct' or 'group') //this column can only choose between the 2 given values

    ChatMember:
        member_id PK FKEY User(id)
        chat_id PK FKEY ChatRoom(id)
        last_read_message_id FKEY Message(id) NULLABLE //no message read yet when a member first joins

    Message:
        id PK
        chat_id FKEY ChatRoom(id)
        sender FKEY User(id)
        created_at
        content

    PendingFriendRequest:
        id PK
        sender_id FKEY User(id)
        receiver_id FKEY User(id)
        UNIQUE (sender_id, receiver_id)

    FriendListMember: //adding a mutual friendship between A and B mean adding 2 records, (A,B) and (B,A)
        id PK FKEY User(id)
        friendId PK FKEY User(id)
    //There is no constraint stopping user from befriending themself, you just have to check for it in the middlewares.

API Specifications:

    POST    /account/signup
        //body: {name,email,password,tel} (route unprotected)

    POST    /account/login                                                  
        //Check if account existed then validate the password (if either of these checks failed, return the same fail response "Invalid email or password").
        //After validation return valid, if an expired session record of the same account already existed then delete the session record. After that, create a new session record for this account. Finally, set the cookie header with session id and send back the response (route unprotected)

    POST    /account/logout
        //always send back the header to clear session cookies and delete the session record in the db (if it exist)

    GET     /account/me
        //return the user's data or { user: null } (status:200) if there is no session

    GET     /chatrooms
        //retrieve a list of all the chat rooms that have this user as it's member

    POST    /chatrooms
        //create a new chat room (body: type, member_ids, name?)

    GET     /chatrooms/:chatid/messages?before=<message_id>&limit=50
        //retrieve all messages of that chat room

    POST    /chatrooms/:chatid/messages
        //post a message to the database

    GET     /friend/search/:tel
        //search users by phone number to find someone to friend-request

    GET     /friend
        //retrieve the user's friends list

    DELETE  /friend/:id
        //unfriend

    GET     /friend/requests
        //retrieve the list of friend requests

    POST    /friend/requests
        //send a friend request (body: receiver_id). If the receiver already sent one to you, deny and point to inbox instead

    POST    /friend/requests/:id/accept
        //accept the friend request

    DELETE  /friend/requests/:id
        //reject the friend request

Example project folder structure:

message-app/
├── frontend/                   // React frontend workspace (currently empty)
├── server/
│   ├── package.json            // Server dependencies and scripts
│   ├── tsconfig.json           // Server TypeScript configuration
│   ├── prisma.config.ts        // Prisma client configuration
│   ├── .env                    // Server environment variables
│   ├── prisma/
│   │   ├── schema.prisma
│   │   └── migrations
│   │       
│   ├── src/
│   │   ├── app.ts              // Express app configuration (middlewares, routes)
│   │   ├── server.ts           // Start the server
│   │   ├── config/
│   │   │   └── config.ts       // Load and type environment variables
│   │   ├── controllers/
│   │   │   └── AccountControllers.ts
│   │   ├── lib/
│   │   │   ├── passwordHash.ts
│   │   │   └── prisma.ts
│   │   ├── routes/
│   │   │   ├── AccountRoutes.ts
│   │   │   └── ChatRoomRoutes.ts
│   │   └── generated/          // Prisma generated client and models
│   │       └── prisma/
│   └── test/
│       ├── account-signup.http
│       └── AccountControllers.test.ts

Cors config details to keep in mind when sending cookies:

// Express (origin: http://localhost:3000)
app.use(cors({ origin: 'http://localhost:5173', credentials: true }));

// React (origin: http://localhost:5173)
fetch('http://localhost:3000/me', { credentials: 'include' });