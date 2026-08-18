import type { Request, Response, NextFunction } from 'express';

// Must keep all four parameters, even though `next` is only used in one branch -
// Express recognizes error-handling middleware purely by function arity (4 params).
// Register this last in app.ts, after every route, so errors from any of them reach it.
export function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction) {
  if (res.headersSent) {
    return next(err);
  }

  console.error(`Error handling ${req.method} ${req.originalUrl}:`, err);
  res.status(500).json({ error: 'Internal server error' });
}
