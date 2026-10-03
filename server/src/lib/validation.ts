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
