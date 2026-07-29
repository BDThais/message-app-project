import express from 'express';
import accountRoutes from './routes/AccountRoutes';
import chatroomRoutes from './routes/ChatRoomRoutes';

const app = express();

app.use(express.json());

//Routes

app.use('/account', accountRoutes);
app.use('/chatrooms', chatroomRoutes);

export default app;