import type { Request, Response } from 'express';
import type { ApiErrorBody } from '../../contract/errors';
import type { HealthResponse } from '../../contract/responses';
import { isDatabaseReachable } from './health.service';

/** GET /api/health: the process is up and answering. Does not touch the database, so a database outage does not get the server restarted. */
export function getHealth(_req: Request, res: Response<HealthResponse>) {
  res.status(200).json({ status: 'ok' });
}

/** GET /api/health/ready: the process can do its work, which needs the database. */
export async function getReadiness(_req: Request, res: Response<HealthResponse | ApiErrorBody>) {
  if (!(await isDatabaseReachable())) {
    return res.status(503).json({ error: 'Database unavailable' });
  }
  res.status(200).json({ status: 'ok' });
}
