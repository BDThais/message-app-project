import { afterEach, describe, expect, it, vi } from 'vitest';

// config.ts reads process.env once, when it is first imported, so each case sets the variable and
// imports a fresh copy. The variables are always set (a blank value counts as not set, and is how
// the defaults are tested): an unset variable would let a developer's own server/.env, which
// config.ts also loads, decide the result.
async function loadConfig() {
  vi.resetModules();

  return (await import('../../src/config/config')).default;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

// Every number in config.ts goes through numberSetting, which reads it with Number(), never parseInt():
// parseInt('7d') is 7, a session that lasts 7 milliseconds, and nothing at startup would say so.
const numericSettings = [
  { name: 'PORT', fallback: 3000 },
  { name: 'SESSION_TTL_MS', fallback: 604_800_000 },
  { name: 'EMPTY_ROOM_RETENTION_MS', fallback: 604_800_000 },
  { name: 'EMPTY_ROOM_CLEANUP_INTERVAL_MS', fallback: 3_600_000 },
  { name: 'EMAIL_VERIFICATION_TTL_MS', fallback: 86_400_000 },
] as const;

describe.each(numericSettings)('$name', ({ name, fallback }) => {
  it('is the number that was set', async () => {
    vi.stubEnv(name, '1234');

    expect((await loadConfig())[name]).toBe(1234);
  });

  it.each(['', '   '])('falls back to %j (blank counts as not set)', async (blank) => {
    vi.stubEnv(name, blank);

    expect((await loadConfig())[name]).toBe(fallback);
  });

  it.each(['24h', '7d', '1 day', 'abc', '86400000ms', '3000abc', '1,000'])(
    'is not a number for %j, so the startup checks refuse it',
    async (value) => {
      vi.stubEnv(name, value);

      expect((await loadConfig())[name]).toBeNaN();
    }
  );

  it('keeps a value of 0 (it is not mistaken for "not set")', async () => {
    vi.stubEnv(name, '0');

    expect((await loadConfig())[name]).toBe(0);
  });
});
