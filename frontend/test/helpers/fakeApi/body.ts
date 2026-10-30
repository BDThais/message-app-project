import type { Body } from './state';

/**
 * A text field of the request body; `''` when it is missing or is not text, which the server's
 * validators also refuse (a number where a string is wanted is a 400, not the number as text).
 */
export function textField(body: Body, name: string): string {
  const value = body?.[name];
  return typeof value === 'string' ? value : '';
}

/** A numeric field of the request body; `NaN` when it is missing or is not a number, which matches no id. */
export function numberField(body: Body, name: string): number {
  const value = body?.[name];
  return typeof value === 'number' ? value : Number.NaN;
}
