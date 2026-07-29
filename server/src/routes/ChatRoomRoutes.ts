import Router from 'express';

const chatRoomRouter = Router();

chatRoomRouter.get('/', (req, res) => {});
chatRoomRouter.post('/', (req, res) => {});
chatRoomRouter.get('/:chatid/messages', (req, res) => {});
chatRoomRouter.post('/:chatid/messages', (req, res) => {});

export default chatRoomRouter;