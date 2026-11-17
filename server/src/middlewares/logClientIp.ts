import type { RequestHandler } from 'express';

/**
 * For the first requests only: logs what Express made of the client's address and what it was made from,
 * so the right TRUST_PROXY for a new host can be read off the logs (see deployment.doc.md). Switched on by
 * LOG_CLIENT_IP=true and meant to be switched off again afterwards; it logs addresses, which are personal data.
 */
export function logClientIp(limit = 10): RequestHandler {
  let logged = 0;

  return (req, _res, next) => {
    if (logged < limit) {
      logged += 1;
      console.log(
        `client ip check ${logged}/${limit}: req.ip=${req.ip} req.ips=${JSON.stringify(req.ips)} ` +
          `x-forwarded-for=${JSON.stringify(req.headers['x-forwarded-for'] ?? null)} socket=${req.socket.remoteAddress}`,
      );
    }
    next();
  };
}
