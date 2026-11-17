import { existsSync } from 'node:fs';
import { isIP } from 'node:net';
import path from 'node:path';

// The settings that only matter once the server runs behind a host: how many proxies stand in front
// of it, which origin the app is served from, and where the built frontend is. No Express and no
// database in here: the parsing and the checks are plain functions, and server.ts runs the checks
// before it listens (like the other settings checks).

/** What Express's `trust proxy` accepts, apart from `true`, which this app never uses. */
export type TrustProxy = false | number | string[];

const PROXY_KEYWORDS = ['loopback', 'linklocal', 'uniquelocal'];

function isIpOrCidr(value: string): boolean {
  const [address = '', prefix, ...rest] = value.split('/');
  if (rest.length > 0 || isIP(address) === 0) return false;
  if (prefix === undefined) return true;
  const max = isIP(address) === 4 ? 32 : 128;
  return /^\d+$/.test(prefix) && Number(prefix) <= max;
}

/**
 * Reads TRUST_PROXY. Blank, '0' and 'false' mean no proxy: Express then takes the address of the TCP
 * peer. A whole number is how many proxies to trust, counted from the one that talks to this process:
 * with 1, the address the last proxy saw is the client's; the X-Forwarded-For entries before it are
 * whatever the client wrote and are ignored. Anything else is a comma-separated list of Express's
 * keywords and of addresses or subnets, trusted wherever they appear in the chain.
 *
 * `true` is refused: it trusts the whole header, so a client can pick its own address and walk around
 * every rate limit (and `false` behind a proxy gives every user the proxy's address, one budget for all).
 */
export function parseTrustProxy(raw: string): TrustProxy {
  const value = raw.trim().toLowerCase();
  if (value === '' || value === 'false') return false;
  if (value === 'true') {
    throw new Error(
      'TRUST_PROXY=true trusts every X-Forwarded-For entry, so a client could choose its own address: use the number of proxies in front of the server (for example 1)',
    );
  }
  if (/^\d+$/.test(value)) {
    const hops = Number(value);
    return hops === 0 ? false : hops;
  }

  const entries = value.split(',').map((entry) => entry.trim());
  const invalid = entries.find((entry) => !PROXY_KEYWORDS.includes(entry) && !isIpOrCidr(entry));
  if (invalid !== undefined) {
    throw new Error(
      `TRUST_PROXY is not valid: "${invalid}" is not a number, one of ${PROXY_KEYWORDS.join(', ')} or an IP address or subnet`,
    );
  }
  return entries;
}

/** The settings (a subset of config.ts) the deployment depends on. */
export interface DeploymentSettings {
  NODE_ENV: string;
  DATABASE_URL: string;
  APP_ORIGIN: string;
  TRUST_PROXY: string;
  FRONTEND_DIST: string;
}

/**
 * Throws on a setting that cannot work, so a bad deployment stops at startup with the reason, instead
 * of answering with the wrong client address or refusing every browser. Call it from server.ts only,
 * like the other settings checks. A setting that is given is checked in every environment; in
 * production the ones that have no safe default must be given.
 */
export function checkDeploymentSettings(settings: DeploymentSettings): void {
  const production = settings.NODE_ENV === 'production';

  if (production && !settings.DATABASE_URL) {
    throw new Error('DATABASE_URL is required when NODE_ENV=production');
  }

  if (production && !settings.TRUST_PROXY.trim()) {
    throw new Error(
      'TRUST_PROXY is required when NODE_ENV=production: the number of reverse proxies in front of the server (1 on most hosts, 0 when the server takes connections directly). A wrong number breaks the rate limits, see deployment.doc.md',
    );
  }
  parseTrustProxy(settings.TRUST_PROXY);

  const origin = settings.APP_ORIGIN.trim();
  if (production && !origin) {
    throw new Error(
      'APP_ORIGIN is required when NODE_ENV=production: the address the app is opened at, for example "https://chat.example.com"',
    );
  }
  if (origin) {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error(`APP_ORIGIN is not a valid URL: "${origin}"`);
    }
    if (parsed.origin !== origin) {
      throw new Error(
        `APP_ORIGIN must be an origin only (scheme, host and port, no path and no trailing slash): "${parsed.origin}", not "${origin}"`,
      );
    }
    if (production && parsed.protocol !== 'https:') {
      throw new Error(`APP_ORIGIN must be an https address when NODE_ENV=production, got "${origin}"`);
    }
  }

  const dist = settings.FRONTEND_DIST.trim();
  if (dist && !existsSync(path.join(dist, 'index.html'))) {
    throw new Error(`FRONTEND_DIST is set to "${dist}", but there is no index.html in it: build the frontend first`);
  }
}
