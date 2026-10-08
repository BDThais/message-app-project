import dotenv from 'dotenv';
dotenv.config();

// Numbers are read with Number(), never parseInt(): parseInt('7d') is 7 and parseInt('24h') is 24, so a
// typo in the unit used to turn into a few milliseconds without a word (a session or a link that
// died at once), while Number('7d') is NaN, which the startup checks refuse (checkSessionSettings,
// checkEmailVerificationSettings, startEmptyChatRoomCleanup; listen() refuses a NaN port). A blank
// value counts as not set.
function numberSetting(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();

  return Number(raw ? raw : fallback);
}

interface Config {
  PORT: number;
  NODE_ENV: string;
  DATABASE_URL: string;
  SESSION_COOKIE: string;
  SESSION_TTL_MS: number;
  EMPTY_ROOM_RETENTION_MS: number;
  EMPTY_ROOM_CLEANUP_INTERVAL_MS: number;
  MAIL_TRANSPORT: string;
  RESEND_API_KEY: string;
  MAIL_FROM: string;
  EMAIL_VERIFICATION_TTL_MS: number;
  EMAIL_VERIFICATION_URL: string;
}
const NODE_ENV = process.env.NODE_ENV || 'development';
const config: Config = {
  PORT: numberSetting('PORT', 3000),
  NODE_ENV,
  DATABASE_URL: process.env.DATABASE_URL || 'backup_database_url_here',
  SESSION_COOKIE: process.env.SESSION_COOKIE || 'session_id',
  SESSION_TTL_MS: numberSetting('SESSION_TTL_MS', 604800000), // How long a login session lasts. Default: 7 days. Validated at startup by checkSessionSettings.
  EMPTY_ROOM_RETENTION_MS: numberSetting('EMPTY_ROOM_RETENTION_MS', 604800000), // How long a room with no members is kept before it (and its messages) is deleted. Default: 7 days.
  EMPTY_ROOM_CLEANUP_INTERVAL_MS: numberSetting('EMPTY_ROOM_CLEANUP_INTERVAL_MS', 3600000), // How often the server looks for rooms that have been empty long enough. Default: 1 hour.
  MAIL_TRANSPORT: process.env.MAIL_TRANSPORT || 'console', // 'console' (only logs mails) or 'resend'. Must be 'resend' when NODE_ENV=production. Validated at startup by createMailerFromConfig.
  RESEND_API_KEY: process.env.RESEND_API_KEY || '', // Required when MAIL_TRANSPORT=resend.
  MAIL_FROM: process.env.MAIL_FROM || '', // Sender of every mail, e.g. 'Message App <no-reply@yourdomain.com>'. Required when MAIL_TRANSPORT=resend.
  EMAIL_VERIFICATION_TTL_MS: numberSetting('EMAIL_VERIFICATION_TTL_MS', 86400000), // How long an emailed verification link works. Default: 24 hours. Validated at startup by checkEmailVerificationSettings.
  EMAIL_VERIFICATION_URL: process.env.EMAIL_VERIFICATION_URL || (NODE_ENV === 'production' ? '' : 'http://localhost:5173/verify-email'), // The frontend page the mailed link opens (the token is appended as #token=...). Required when NODE_ENV=production, so a mail can never point at localhost. Validated at startup by checkEmailVerificationSettings.
};
export default config;