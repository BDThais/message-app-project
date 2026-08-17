# Message App

A full-stack real-time messaging application built with TypeScript, Express.js, PostgreSQL, Prisma, and React. The backend currently includes the core account management flow: signup, login, session-based authentication, and logout.

## Project Status

This repository is in active development. The implemented backend features include:

- User signup
- User login
- Session creation and cookie-based auth
- Fetch current authenticated user
- User logout and session cleanup

The chat, messaging, and friendship features are planned for future implementation.

## Tech Stack

- Backend: Express.js + TypeScript
- Database: PostgreSQL + Prisma ORM
- Frontend: React
- Data fetching: TanStack Query
- Routing: TanStack Router
- Real-time communication: Socket.io

## Backend API

### Auth endpoints

#### POST /account/signup
Creates a new user.

Request body:
```json
{
  "name": "John Doe",
  "email": "john@example.com",
  "password": "secret123",
  "tel": "+1234567890"
}
```

#### POST /account/login
Authenticates a user and creates a session cookie.

Request body:
```json
{
  "email": "john@example.com",
  "password": "secret123"
}
```

#### GET /account/me
Returns the authenticated user or null when no session is active.

#### POST /account/logout
Clears the session cookie and removes the session from the database.

## Roadmap

- Implement chat room APIs
- Add message sending and fetching
- Add friend search and friendship requests
- Add Socket.io for real-time messaging
- Build the React frontend
- Add protected UI routing and auth-aware state
- Harden deployment configuration for production

## License

This project is currently for personal/development use unless a different license is added later.