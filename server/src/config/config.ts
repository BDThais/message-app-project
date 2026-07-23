import dotenv from 'dotenv';
dotenv.config();
interface Config {
  PORT: number;
  NODE_ENV: string;
  DATABASE_URL: string;
}
const config: Config = {
  PORT: parseInt(process.env.PORT || '3000', 10),
  NODE_ENV: process.env.NODE_ENV || 'development',
  DATABASE_URL: process.env.DATABASE_URL || 'backup_database_url_here',
};
export default config;