// What the mailed links that open a frontend page have in common (email verification and password
// reset): the setting that holds the page's address is checked when the server starts, and the
// token is added to the address as a URL fragment. No database and no Express in here.

/**
 * Throws when the setting that holds the address of a frontend page cannot work, so a bad
 * deployment stops at startup instead of mailing links that never open. `name` is the setting's
 * name, `purpose` finishes the sentence "the address of the frontend page that ..." and `example`
 * is shown when the setting is missing. Call it from the feature's own settings check.
 */
export function checkFrontendPageUrl(options: {
  name: string;
  value: string;
  nodeEnv: string;
  purpose: string;
  example: string;
}): void {
  const { name, nodeEnv, purpose, example } = options;

  const url = options.value.trim();
  if (!url) {
    // Only reachable in production: elsewhere config.ts supplies the development page.
    throw new Error(
      `${name} is required${nodeEnv === 'production' ? ' when NODE_ENV=production' : ''}: ` +
        `the address of the frontend page that ${purpose} (for example "${example}")`
    );
  }
  // The token is added as the fragment, so the base must not have one already.
  if (url.includes('#')) {
    throw new Error(`${name} must not contain a "#": the token is added as the URL fragment`);
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`${name} is not a valid absolute URL: "${url}"`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`${name} must be an http or https URL, got "${url}"`);
  }
}

/**
 * The link in a mail: the frontend page, with the token as a fragment (`...#token=...`). A
 * fragment is never sent to a server, so the token stays out of access logs and `Referer`
 * headers. A token is base64url, so it needs no escaping.
 */
export function buildTokenLink(baseUrl: string, token: string): string {
  return `${baseUrl.trim()}#token=${token}`;
}
