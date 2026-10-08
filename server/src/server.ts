import app from './app';
import config from './config/config';
import { createMailerFromConfig, setMailer } from './lib/mailer';
import { checkEmailVerificationSettings } from './modules/account/emailVerification.mail';
import { checkSessionSettings } from './modules/account/session.service';
import { startEmptyChatRoomCleanup } from './modules/chatrooms/chatRoomCleanup.job';

// Before listen: a setting that cannot work stops the server before it takes requests.
setMailer(createMailerFromConfig(config));
checkEmailVerificationSettings(config);
checkSessionSettings(config);

app.listen(config.PORT, () => {
  console.log(`Server is running on port ${config.PORT}`);
});

startEmptyChatRoomCleanup({
  retentionMs: config.EMPTY_ROOM_RETENTION_MS,
  intervalMs: config.EMPTY_ROOM_CLEANUP_INTERVAL_MS,
});
