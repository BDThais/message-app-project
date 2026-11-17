import express from 'express';
import cookieParser from 'cookie-parser';
import config from './config/config';
import { parseTrustProxy, type TrustProxy } from './lib/deploymentSettings';
import accountRoutes from './modules/account/account.routes';
import chatroomRoutes from './modules/chatrooms/chatRoom.routes';
import friendRoutes from './modules/friends/friend.routes';
import healthRoutes from './modules/health/health.routes';
import { errorHandler, notFoundHandler } from './middlewares/ErrorHandler';
import { logClientIp } from './middlewares/logClientIp';
import { securityHeaders } from './middlewares/securityHeaders';
import { mountFrontend } from './middlewares/serveFrontend';

export interface AppOptions {
  /** Express's `trust proxy`: how many reverse proxies stand in front (see TRUST_PROXY). Default: none. */
  trustProxy?: TrustProxy;
  /** The origin the app is opened at (see APP_ORIGIN): only the security headers use it here. */
  appOrigin?: string;
  /** The folder of the built frontend (see FRONTEND_DIST): when given, this app serves it too. */
  frontendDist?: string;
  /** Log what the first requests look like (see LOG_CLIENT_IP). */
  logClientIp?: boolean;
}

/**
 * Builds the Express app. The default export below is the one the server and the tests use, made from
 * config.ts; the options exist so that each deployment behavior can be tried on an app of its own.
 */
export function createApp(options: AppOptions = {}) {
  const app = express();

  // Before every middleware that reads the client's address (the rate limiters do).
  app.set('trust proxy', options.trustProxy ?? false);

  if (options.logClientIp) app.use(logClientIp());
  app.use(securityHeaders(options.appOrigin ?? ''));
  app.use(express.json());
  app.use(cookieParser());

  //Routes

  app.use('/api/health', healthRoutes);
  app.use('/api/account', accountRoutes);
  app.use('/api/chat', chatroomRoutes);
  app.use('/api/friend', friendRoutes);

  // An /api path no route answered is a JSON 404, also when the frontend is served below, whose fallback
  // would otherwise answer it with index.html.
  app.use('/api', notFoundHandler);
  if (options.frontendDist) mountFrontend(app, options.frontendDist);

  //Not Found and Error Handler (keep them last, in this order: an unmatched request is a 404 before it can be an error)
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export default createApp({
  trustProxy: parseTrustProxy(config.TRUST_PROXY),
  appOrigin: config.APP_ORIGIN,
  frontendDist: config.FRONTEND_DIST,
  logClientIp: config.LOG_CLIENT_IP,
});
