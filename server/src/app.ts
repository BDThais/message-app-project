import express from 'express';
import cookieParser from 'cookie-parser';
import accountRoutes from './routes/AccountRoutes';
import chatroomRoutes from './routes/ChatRoomRoutes';
import { errorHandler } from './middlewares/ErrorHandler';

const app = express();

app.use(express.json());
app.use(cookieParser());

//Routes

app.use('/account', accountRoutes);
app.use('/chatrooms', chatroomRoutes);

app.use(errorHandler);

export default app;