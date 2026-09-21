import express from 'express';
import cookieParser from 'cookie-parser';
import accountRoutes from './modules/account/account.routes';
import chatroomRoutes from './modules/chatrooms/chatRoom.routes';
import { errorHandler } from './middlewares/ErrorHandler';

const app = express();

app.use(express.json());
app.use(cookieParser());

//Routes

app.use('/account', accountRoutes);
app.use('/chatrooms', chatroomRoutes);

//Error Handler
app.use(errorHandler);

export default app;