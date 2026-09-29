import type { Request, Response, NextFunction } from 'express';
import { STATUS_CODES } from 'node:http';

// Errors Express and its body parser raise on a bad request carry the status to
// answer with (http-errors sets `status`): a malformed JSON body or a path
// param with broken percent-encoding is a 400, an oversized body a 413. Only a
// 4xx counts here; anything else, including a 5xx status, is our own failure.
function clientErrorStatus(err: unknown): number | null {
  if (typeof err !== 'object' || err === null) return null;

  const { status, statusCode } = err as { status?: unknown; statusCode?: unknown };
  const code = typeof status === 'number' ? status : statusCode;

  return typeof code === 'number' && Number.isInteger(code) && code >= 400 && code <= 499
    ? code
    : null;
}

// Must keep all four parameters, even though `next` is only used in one branch -
// Express recognizes error-handling middleware purely by function arity (4 params).
// Register this last in app.ts, after every route, so errors from any of them reach it.
//
// Every error body in this API is `{ error: string }`. The key is not `message`
// because several success bodies already use `message` for a chat message
// object (POST/PATCH /chat/:chatid/message), so a client could not tell the two
// apart by looking at the body.
export function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction) {
  if (res.headersSent) {
    return next(err);
  }

  const status = clientErrorStatus(err);
  if (status !== null) {
    // The client's mistake, not ours: nothing to log. `expose` is http-errors'
    // own flag for "this message is safe to show the client"; without it, fall
    // back to the plain status text.
    const { expose, message } = err as { expose?: unknown; message?: unknown };
    const text = expose === true && typeof message === 'string' ? message : STATUS_CODES[status];

    return res.status(status).json({ error: text });
  }

  console.error(`Error handling ${req.method} ${req.originalUrl}:`, err);
  res.status(500).json({ error: 'Internal server error' });
}
