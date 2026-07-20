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
        name
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

    FriendListMember: //add a mutual friendship between A and B mean adding 2 records, (A,B) and (B,A)
        id PK FKEY User(id)
        friendId PK FKEY User(id)
    //There is no constraint stopping user from befriending themself, you just have to check for it in the middlewares.

API Specifications:

    POST    /signup
    POST    /login
    POST    /logout
    GET     /me
    GET     /chatrooms                                          //retrieve a list of all the chat rooms that have this user as it's member
    POST    /chatrooms                                          //create a new chat room (body: type, member_ids, name?)
    GET     /:chatid/messages?before=<message_id>&limit=50      //retrieve all messages of that chat room
    POST    /:chatid/messages                                   //post a message to the database
    GET     /users?search=<query>                               //search users by name/email to find someone to friend-request
    GET     /friends                                            //retrieve the user's friends list
    DELETE  /friends/:id                                        //unfriend
    GET     /friend-requests                                    //retrieve the list of friend requests
    POST    /friend-requests                                    //send a friend request (body: receiver_id). If the receiver already sent one to you, deny and point to inbox instead
    POST    /friend-requests/:id/accept                         //accept the friend request
    DELETE  /friend-requests/:id                                //reject the friend request
