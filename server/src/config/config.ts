import dotenv from 'dotenv';
dotenv.config();

// Numbers are read with Number(), never parseInt(): parseInt('7d') is 7 and parseInt('24h') is 24, so a
// typo in the unit used to turn into a few milliseconds without a word (a session or a link that
// died at once), while Number('7d') is NaN, which the startup checks refuse (checkSessionSettings,
// checkEmailVerificationSettings, checkPasswordResetSettings, startEmptyChatRoomCleanup; listen() refuses a NaN port). A blank
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
  PASSWORD_RESET_TTL_MS: number;
  PASSWORD_RESET_URL: string;
  APP_ORIGIN: string;
  TRUST_PROXY: string;
  FRONTEND_DIST: string;
  LOG_CLIENT_IP: boolean;
}
const NODE_ENV = process.env.NODE_ENV || 'development';
const config: Config = {
  PORT: numberSetting('PORT', 3000),
  NODE_ENV,
  DATABASE_URL: process.env.DATABASE_URL || '', // Required when NODE_ENV=production. Validated at startup by checkDeploymentSettings. (prisma.ts reads process.env.DATABASE_URL itself.)
  SESSION_COOKIE: process.env.SESSION_COOKIE || 'session_id',
  SESSION_TTL_MS: numberSetting('SESSION_TTL_MS', 604800000), // How long a login session lasts. Default: 7 days. Validated at startup by checkSessionSettings.
  EMPTY_ROOM_RETENTION_MS: numberSetting('EMPTY_ROOM_RETENTION_MS', 604800000), // How long a room with no members is kept before it (and its messages) is deleted. Default: 7 days.
  EMPTY_ROOM_CLEANUP_INTERVAL_MS: numberSetting('EMPTY_ROOM_CLEANUP_INTERVAL_MS', 3600000), // How often the server looks for rooms that have been empty long enough. Default: 1 hour.
  MAIL_TRANSPORT: process.env.MAIL_TRANSPORT || 'console', // 'console' (only logs mails) or 'resend'. Must be 'resend' when NODE_ENV=production. Validated at startup by createMailerFromConfig.
  RESEND_API_KEY: process.env.RESEND_API_KEY || '', // Required when MAIL_TRANSPORT=resend.
  MAIL_FROM: process.env.MAIL_FROM || '', // Sender of every mail, e.g. 'Message App <no-reply@yourdomain.com>'. Required when MAIL_TRANSPORT=resend.
  EMAIL_VERIFICATION_TTL_MS: numberSetting('EMAIL_VERIFICATION_TTL_MS', 86400000), // How long an emailed verification link works. Default: 24 hours. Validated at startup by checkEmailVerificationSettings.
  EMAIL_VERIFICATION_URL:
    process.env.EMAIL_VERIFICATION_URL || (NODE_ENV === 'production' ? '' : 'http://localhost:5173/verify-email'), // The frontend page the mailed link opens (the token is appended as #token=...). Required when NODE_ENV=production, so a mail can never point at localhost. Validated at startup by checkEmailVerificationSettings.
  PASSWORD_RESET_TTL_MS: numberSetting('PASSWORD_RESET_TTL_MS', 1800000), // How long an emailed password reset link works. Default: 30 minutes. Validated at startup by checkPasswordResetSettings.
  PASSWORD_RESET_URL:
    process.env.PASSWORD_RESET_URL || (NODE_ENV === 'production' ? '' : 'http://localhost:5173/reset-password'), // The frontend page the mailed reset link opens (the token is appended as #token=...). Required when NODE_ENV=production, so a mail can never point at localhost. Validated at startup by checkPasswordResetSettings.
  APP_ORIGIN: (process.env.APP_ORIGIN || '').trim(), // The one origin (scheme + host + port, no path) the browser loads the app from, e.g. 'https://chat.example.com'. A Socket.io handshake from a browser page on any other origin is refused. Required (and https) when NODE_ENV=production; when empty elsewhere, no origin is checked. Validated at startup by checkDeploymentSettings.
  TRUST_PROXY: (process.env.TRUST_PROXY || '').trim(), // How many reverse proxies sit between the browser and this process: a number ('1'), '0'/'false' for none, or a comma-separated list of 'loopback', 'linklocal', 'uniquelocal' and IPs/CIDRs. Required when NODE_ENV=production, because a wrong value breaks the rate limits (see docs). Validated at startup by checkDeploymentSettings.
  FRONTEND_DIST: (process.env.FRONTEND_DIST || '').trim(), // The folder of the built frontend (it holds index.html). When set, this server serves the frontend as well as the API, on one origin. Validated at startup by checkDeploymentSettings.
  LOG_CLIENT_IP: process.env.LOG_CLIENT_IP === 'true', // Temporary: logs what the first requests look like (req.ip, X-Forwarded-For) so the right TRUST_PROXY can be found on a new host. Turn it off afterwards.
};
export default config;
