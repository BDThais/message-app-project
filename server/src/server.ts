import app from './app';
import config from './config/config';
import { startEmptyChatRoomCleanup } from './modules/chatrooms/chatRoomCleanup.job';

app.listen(config.PORT, () => {
  console.log(`Server is running on port ${config.PORT}`);
});

startEmptyChatRoomCleanup({
  retentionMs: config.EMPTY_ROOM_RETENTION_MS,
  intervalMs: config.EMPTY_ROOM_CLEANUP_INTERVAL_MS,
});
