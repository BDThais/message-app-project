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
    POST    /account/login
    POST    /account/logout
    GET     /account/me
    GET     /chatrooms                                                      //retrieve a list of all the chat rooms that have this user as it's member
    POST    /chatrooms                                                      //create a new chat room (body: type, member_ids, name?)
    GET     /chatrooms/:chatid/messages?before=<message_id>&limit=50        //retrieve all messages of that chat room
    POST    /chatrooms/:chatid/messages                                     //post a message to the database
    GET     /friend/search/:tel                                             //search users by phone number to find someone to friend-request
    GET     /friend                                                         //retrieve the user's friends list
    DELETE  /friend/:id                                                     //unfriend
    GET     /friend/requests                                                //retrieve the list of friend requests
    POST    /friend/requests                                                //send a friend request (body: receiver_id). If the receiver already sent one to you, deny and point to inbox instead
    POST    /friend/requests/:id/accept                                     //accept the friend request
    DELETE  /friend/requests/:id                                            //reject the friend request

Example project structure:

message-app/
├── src/
│   ├── config/
│   │   └── config.ts           // Load and type environment variables
│   ├── controllers/
│   │   └── Controller.ts       // CRUD logic
│   ├── middlewares/
│   │   └── errorHandler.ts     // Global typed error handling middleware
│   ├── models/
│   │   └── item.ts             // Define item type and in-memory storage (Not needed in this project, since it already have prisma)
│   ├── routes/
│   │   └── Routes.ts           // Express routes
│   ├── app.ts                  // Express app configuration (middlewares, routes)
│   └── server.ts               // Start the server
├── .env                        // Environment variables
├── package.json                // Project scripts, dependencies, etc.
├── tsconfig.json               // TypeScript configuration.
└── eslintrc.js                 // ESLint configuration

Example cors details for sending cookies:

// Express (origin: http://localhost:3000)
app.use(cors({ origin: 'http://localhost:5173', credentials: true }));

// React (origin: http://localhost:5173)
fetch('http://localhost:3000/me', { credentials: 'include' });