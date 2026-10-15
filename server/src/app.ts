import express from 'express';
import cookieParser from 'cookie-parser';
import accountRoutes from './modules/account/account.routes';
import chatroomRoutes from './modules/chatrooms/chatRoom.routes';
import friendRoutes from './modules/friends/friend.routes';
import { errorHandler, notFoundHandler } from './middlewares/ErrorHandler';

const app = express();

app.use(express.json());
app.use(cookieParser());

//Routes

app.use('/api/account', accountRoutes);
app.use('/api/chat', chatroomRoutes);
app.use('/api/friend', friendRoutes);

//Not Found and Error Handler (keep them last, in this order: an unmatched request is a 404 before it can be an error)
app.use(notFoundHandler);
app.use(errorHandler);

export default app;