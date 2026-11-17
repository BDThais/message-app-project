import path from 'node:path';
import express, { type Express } from 'express';

/**
 * Makes this server the host of the built frontend too: the app and its API then share one origin, which
 * is what lets the session cookie stay first-party and needs no CORS. Mount it after the API routes.
 *
 * - Files of the build are served as they are. Everything in `assets/` has a hash in its name (Vite), so
 *   a browser may keep it for a year; every other file (index.html, the favicon) is asked about each time.
 * - A path that is not a file and has no extension is a screen of the app (`/chat/3`): index.html, and the
 *   router in the page takes over. A path with an extension that is not a file is a plain 404, not a
 *   page of HTML where the browser expected a script.
 * - `/api` is answered before this (a JSON 404 of its own), and `/socket.io` never gets here.
 */
export function mountFrontend(app: Express, distDir: string): void {
  const root = path.resolve(distDir);
  const assets = path.join(root, 'assets') + path.sep;

  app.use(
    express.static(root, {
      index: false,
      setHeaders(res, filePath) {
        res.setHeader(
          'Cache-Control',
          filePath.startsWith(assets) ? 'public, max-age=31536000, immutable' : 'no-cache',
        );
      },
    }),
  );

  app.use((req, res, next) => {
    if ((req.method !== 'GET' && req.method !== 'HEAD') || path.extname(req.path) !== '') return next();

    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(root, 'index.html'), (error) => {
      if (error) next(error);
    });
  });
}
