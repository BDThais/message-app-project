import helmet from 'helmet';

/**
 * The response headers that tell the browser what a page may do (helmet's defaults, with the changes below).
 * They matter for the HTML this server sends when it serves the frontend, and cost nothing on the JSON answers.
 *
 * - `img-src` takes any https image: a person's avatar is the address of an image anywhere.
 * - `connect-src` names the page's own origin as a WebSocket address too, because some browsers do not
 *   count `'self'` for `wss:` (the app's socket).
 * - `upgrade-insecure-requests` is off: the host sends people to https, and the directive would make
 *   a browser that opens the built app on http://localhost ask for its files on https.
 * - HSTS lasts 180 days and does not cover subdomains: a long lock-in is the one thing here that is hard to undo.
 */
export function securityHeaders(appOrigin: string) {
  const webSocketOrigin = appOrigin ? appOrigin.replace(/^http/, 'ws') : null;

  return helmet({
    contentSecurityPolicy: {
      directives: {
        'img-src': ["'self'", 'data:', 'https:'],
        'connect-src': ["'self'", ...(webSocketOrigin ? [webSocketOrigin] : [])],
        'upgrade-insecure-requests': null,
      },
    },
    strictTransportSecurity: { maxAge: 15_552_000, includeSubDomains: false },
  });
}
