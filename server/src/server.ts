import app from './app';
import config from './config/config';
import { createMailerFromConfig, setMailer } from './lib/mailer';
import { startEmptyChatRoomCleanup } from './modules/chatrooms/chatRoomCleanup.job';

// Before listen: a mail setting that cannot work stops the server before it takes requests.
setMailer(createMailerFromConfig(config));

app.listen(config.PORT, () => {
  console.log(`Server is running on port ${config.PORT}`);
});

startEmptyChatRoomCleanup({
  retentionMs: config.EMPTY_ROOM_RETENTION_MS,
  intervalMs: config.EMPTY_ROOM_CLEANUP_INTERVAL_MS,
});
