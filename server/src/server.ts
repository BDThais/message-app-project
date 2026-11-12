import { createServer } from 'node:http';
import app from './app';
import config from './config/config';
import { createMailerFromConfig, setMailer } from './lib/mailer';
import { checkEmailVerificationSettings } from './modules/account/emailVerification.mail';
import { checkPasswordResetSettings } from './modules/account/passwordReset.mail';
import { checkSessionSettings } from './modules/account/session.service';
import { startEmptyChatRoomCleanup } from './modules/chatrooms/chatRoomCleanup.job';
import { attachRealtime } from './modules/realtime/realtime.server';

// Before listen: a setting that cannot work stops the server before it takes requests.
setMailer(createMailerFromConfig(config));
checkEmailVerificationSettings(config);
checkPasswordResetSettings(config);
checkSessionSettings(config);

// Socket.io needs the HTTP server itself, so it is made here and not by app.listen. A failed listen
// (a port that is already taken, for one) is an 'error' event of that server; without the handler the
// process would throw, or idle on the cleanup job's timer.
const httpServer = createServer(app);
attachRealtime(httpServer);

httpServer.on('error', (error) => {
  console.error(`Could not listen on port ${config.PORT}:`, error);
  process.exit(1);
});
httpServer.listen(config.PORT, () => {
  console.log(`Server is running on port ${config.PORT}`);
});

startEmptyChatRoomCleanup({
  retentionMs: config.EMPTY_ROOM_RETENTION_MS,
  intervalMs: config.EMPTY_ROOM_CLEANUP_INTERVAL_MS,
});
