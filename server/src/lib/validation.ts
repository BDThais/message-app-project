// Small checks shared by the validators of several features (chat rooms and
// the account profile both take an `avatar_url`).

/** An http(s) URL. Other schemes (javascript:, data:, file:) are refused. */
export function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Express leaves req.body undefined when the request has no JSON body, so validators narrow it with this first. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * The fields of a request body (or of a query string), each one `unknown` until the validator has
 * checked it. `B` is the body's or query's type from contract/requests.ts, so a key the contract does not have (a typo, or a rename
 * made in the contract only) does not compile when destructured. Without a JSON body (Express
 * leaves req.body undefined) or with one that is not an object, every field is undefined.
 */
export function bodyFields<B>(body: unknown): { [K in keyof B]?: unknown } {
  return isRecord(body) ? (body as { [K in keyof B]?: unknown }) : {};
}
