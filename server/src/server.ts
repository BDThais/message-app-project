import app from './app';
import config from './config/config';
import { createMailerFromConfig, setMailer } from './lib/mailer';
import { checkEmailVerificationSettings } from './modules/account/emailVerification.mail';
import { checkPasswordResetSettings } from './modules/account/passwordReset.mail';
import { checkSessionSettings } from './modules/account/session.service';
import { startEmptyChatRoomCleanup } from './modules/chatrooms/chatRoomCleanup.job';

// Before listen: a setting that cannot work stops the server before it takes requests.
setMailer(createMailerFromConfig(config));
checkEmailVerificationSettings(config);
checkPasswordResetSettings(config);
checkSessionSettings(config);

// Express 5 hands a failed listen (a port that is already taken, for one) to this callback instead of
// throwing. Without the check the process printed "Server is running" and idled on the cleanup job's timer.
app.listen(config.PORT, (error?: Error) => {
  if (error) {
    console.error(`Could not listen on port ${config.PORT}:`, error);
    process.exit(1);
  }
  console.log(`Server is running on port ${config.PORT}`);
});

startEmptyChatRoomCleanup({
  retentionMs: config.EMPTY_ROOM_RETENTION_MS,
  intervalMs: config.EMPTY_ROOM_CLEANUP_INTERVAL_MS,
});
