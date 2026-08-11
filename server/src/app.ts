import express from 'express';
import cookieParser from 'cookie-parser';
import accountRoutes from './routes/AccountRoutes';
import chatroomRoutes from './routes/ChatRoomRoutes';

const app = express();

app.use(express.json());
app.use(cookieParser());

//Routes

app.use('/account', accountRoutes);
app.use('/chatrooms', chatroomRoutes);

export default app;