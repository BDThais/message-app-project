import { MAX_INT32 as MAX_ID } from './constants';

/**
 * Turns a numeric URL param into an ID, or null if it isn't one. Only plain
 * digit strings between 1 and MAX_ID are accepted, so forms Number() would
 * happily coerce - '1e3', ' 5 ', '0x10', '' - are rejected instead of
 * silently pointing at some other row.
 */
export function parseIdParam(raw: unknown): number | null {
  const id = typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : NaN;

  return Number.isInteger(id) && id >= 1 && id <= MAX_ID ? id : null;
}
