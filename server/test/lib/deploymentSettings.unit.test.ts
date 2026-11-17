import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkDeploymentSettings, parseTrustProxy, type DeploymentSettings } from '../../src/lib/deploymentSettings';

describe('parseTrustProxy', () => {
  it.each(['', '  ', 'false', 'FALSE', '0'])('means no proxy for %j', (raw) => {
    expect(parseTrustProxy(raw)).toBe(false);
  });

  it('reads a whole number as the number of proxies to trust', () => {
    expect(parseTrustProxy('1')).toBe(1);
    expect(parseTrustProxy(' 2 ')).toBe(2);
  });

  it('reads a list of keywords, addresses and subnets, whatever their case and spacing', () => {
    expect(parseTrustProxy('loopback, 10.0.0.0/8 ,fd00::/8,203.0.113.7')).toEqual([
      'loopback',
      '10.0.0.0/8',
      'fd00::/8',
      '203.0.113.7',
    ]);
  });

  it('refuses true: it would let a client choose its own address', () => {
    expect(() => parseTrustProxy('true')).toThrow(/trusts every X-Forwarded-For entry/);
  });

  it.each(['yes', '1.5', '-1', '10.0.0.0/33', 'fd00::/129', '10.0.0.0/8/8', '300.1.1.1', 'loopback,nope'])(
    'refuses %j and says which entry is wrong',
    (raw) => {
      expect(() => parseTrustProxy(raw)).toThrow(/TRUST_PROXY is not valid/);
    },
  );
});

describe('checkDeploymentSettings', () => {
  const production: DeploymentSettings = {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://user:pass@db:5432/app',
    APP_ORIGIN: 'https://chat.example.com',
    TRUST_PROXY: '1',
    FRONTEND_DIST: '',
  };
  const development: DeploymentSettings = {
    ...production,
    NODE_ENV: 'development',
    DATABASE_URL: '',
    APP_ORIGIN: '',
    TRUST_PROXY: '',
  };

  it('accepts a complete production setup, and a development one with nothing set', () => {
    expect(() => checkDeploymentSettings(production)).not.toThrow();
    expect(() => checkDeploymentSettings(development)).not.toThrow();
  });

  it.each([
    ['DATABASE_URL', { DATABASE_URL: '' }],
    ['TRUST_PROXY', { TRUST_PROXY: ' ' }],
    ['APP_ORIGIN', { APP_ORIGIN: '' }],
  ] as const)('requires %s in production, and names it', (name, override) => {
    expect(() => checkDeploymentSettings({ ...production, ...override })).toThrow(new RegExp(`${name} is required`));
  });

  it('accepts "0" as an explicit answer for TRUST_PROXY in production: the server takes connections directly', () => {
    expect(() => checkDeploymentSettings({ ...production, TRUST_PROXY: '0' })).not.toThrow();
  });

  it('checks a TRUST_PROXY that is given, in every environment', () => {
    expect(() => checkDeploymentSettings({ ...development, TRUST_PROXY: 'true' })).toThrow(/TRUST_PROXY=true/);
  });

  it.each([
    ['not a URL', 'chat.example.com', /not a valid URL/],
    ['a path', 'https://chat.example.com/app', /origin only/],
    ['a trailing slash', 'https://chat.example.com/', /origin only/],
    ['a default port written out', 'https://chat.example.com:443', /origin only/],
  ])('refuses an APP_ORIGIN that is %s', (_label, origin, message) => {
    expect(() => checkDeploymentSettings({ ...development, APP_ORIGIN: origin })).toThrow(message);
  });

  it('needs an https APP_ORIGIN in production, and takes http elsewhere (the dev server)', () => {
    expect(() => checkDeploymentSettings({ ...production, APP_ORIGIN: 'http://chat.example.com' })).toThrow(/https/);
    expect(() => checkDeploymentSettings({ ...development, APP_ORIGIN: 'http://localhost:5173' })).not.toThrow();
  });

  it('wants an index.html in FRONTEND_DIST', () => {
    const empty = mkdtempSync(path.join(tmpdir(), 'dist-empty-'));
    const built = mkdtempSync(path.join(tmpdir(), 'dist-built-'));
    writeFileSync(path.join(built, 'index.html'), '<!doctype html>');

    expect(() => checkDeploymentSettings({ ...production, FRONTEND_DIST: empty })).toThrow(/no index\.html/);
    expect(() => checkDeploymentSettings({ ...production, FRONTEND_DIST: built })).not.toThrow();
  });
});
