import dotenv from 'dotenv';
dotenv.config();
interface Config {
  PORT: number;
  NODE_ENV: string;
  DATABASE_URL: string;
  SESSION_COOKIE: string;
  SESSION_TTL_MS: number;
  EMPTY_ROOM_RETENTION_MS: number;
  EMPTY_ROOM_CLEANUP_INTERVAL_MS: number;
}
const config: Config = {
  PORT: parseInt(process.env.PORT || '3000', 10),
  NODE_ENV: process.env.NODE_ENV || 'development',
  DATABASE_URL: process.env.DATABASE_URL || 'backup_database_url_here',
  SESSION_COOKIE: process.env.SESSION_COOKIE || 'session_id',
  SESSION_TTL_MS: parseInt(process.env.SESSION_TTL_MS || '604800000', 10),
  // How long a room with no members is kept before it (and its messages) is deleted. Default: 7 days.
  EMPTY_ROOM_RETENTION_MS: parseInt(process.env.EMPTY_ROOM_RETENTION_MS || '604800000', 10),
  // How often the server looks for rooms that have been empty long enough. Default: 1 hour.
  EMPTY_ROOM_CLEANUP_INTERVAL_MS: parseInt(process.env.EMPTY_ROOM_CLEANUP_INTERVAL_MS || '3600000', 10),
};
export default config;