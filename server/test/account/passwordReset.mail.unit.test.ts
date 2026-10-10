import { afterEach, describe, expect, it, vi } from 'vitest';
import config from '../../src/config/config';
import { setMailer } from '../../src/lib/mailer';
import type { Mailer } from '../../src/lib/mailer';
import {
  checkPasswordResetSettings,
  sendPasswordChangedEmail,
  sendPasswordResetEmail,
} from '../../src/modules/account/passwordReset.mail';
import { InMemoryMailer } from '../helpers/mailer';

// The rules every frontend page address has to follow (absolute http(s), no fragment) are checked
// in emailVerification.mail.unit.test.ts, through the same helper; here only what is the reset's own.

const goodSettings = {
  NODE_ENV: 'production',
  PASSWORD_RESET_URL: 'https://app.example.com/reset-password',
  PASSWORD_RESET_TTL_MS: 30 * 60 * 1000,
};

const DAY_MS = 24 * 60 * 60 * 1000;

afterEach(() => {
  setMailer(null);
  vi.restoreAllMocks();
});

describe('checkPasswordResetSettings', () => {
  it('accepts a good production setup and the development defaults', () => {
    expect(() => checkPasswordResetSettings(goodSettings)).not.toThrow();
    expect(() =>
      checkPasswordResetSettings({
        NODE_ENV: 'development',
        PASSWORD_RESET_URL: 'http://localhost:5173/reset-password',
        PASSWORD_RESET_TTL_MS: 1_800_000,
      })
    ).not.toThrow();
  });

  it('accepts the shortest and the longest lifetime', () => {
    expect(() => checkPasswordResetSettings({ ...goodSettings, PASSWORD_RESET_TTL_MS: 1 })).not.toThrow();
    expect(() => checkPasswordResetSettings({ ...goodSettings, PASSWORD_RESET_TTL_MS: DAY_MS })).not.toThrow();
  });

  it.each([
    { desc: 'NaN (a mistyped number)', ttl: Number.NaN },
    { desc: 'zero', ttl: 0 },
    { desc: 'a negative number', ttl: -1 },
    { desc: 'a fraction', ttl: 1.5 },
    { desc: 'more than a day', ttl: DAY_MS + 1 },
    { desc: 'Infinity', ttl: Number.POSITIVE_INFINITY },
  ])('rejects a lifetime of $desc, and names the setting', ({ ttl }) => {
    expect(() => checkPasswordResetSettings({ ...goodSettings, PASSWORD_RESET_TTL_MS: ttl })).toThrow(
      /PASSWORD_RESET_TTL_MS/
    );
  });

  it('requires the page URL in production, and says why', () => {
    expect(() => checkPasswordResetSettings({ ...goodSettings, PASSWORD_RESET_URL: '' })).toThrow(
      /PASSWORD_RESET_URL is required when NODE_ENV=production/
    );
  });

  it.each([
    { desc: 'a relative path', url: '/reset-password', message: /PASSWORD_RESET_URL is not a valid absolute URL/ },
    { desc: 'a scheme other than http(s)', url: 'javascript:alert(1)', message: /PASSWORD_RESET_URL must be an http or https URL/ },
    { desc: 'a URL that already has a fragment', url: 'https://app.example.com/reset#top', message: /PASSWORD_RESET_URL must not contain a "#"/ },
  ])('rejects $desc, and names the setting', ({ url, message }) => {
    expect(() => checkPasswordResetSettings({ ...goodSettings, PASSWORD_RESET_URL: url })).toThrow(message);
  });
});

describe('sendPasswordResetEmail', () => {
  it('sends one plain-text mail to the address, with the link in the fragment form', async () => {
    const outbox = new InMemoryMailer();
    setMailer(outbox);

    await sendPasswordResetEmail('alice@example.com', 'the-token');

    expect(outbox.sent).toHaveLength(1);
    expect(outbox.sent[0]).toMatchObject({ to: 'alice@example.com', subject: 'Reset your password' });
    expect(outbox.sent[0]!.text).toContain(`${config.PASSWORD_RESET_URL}#token=the-token`);
  });

  it('never rejects: a failed send is logged without the address or the token', async () => {
    const failing: Mailer = { send: () => Promise.reject(new Error('Resend could not send the email (rate_limit_exceeded, HTTP 429): slow down')) };
    setMailer(failing);
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(sendPasswordResetEmail('alice@example.com', 'the-token')).resolves.toBeUndefined();

    expect(logged).toHaveBeenCalledTimes(1);
    // An Error does not survive JSON.stringify (it becomes {}), so read the real text of every argument.
    const text = logged.mock.calls.flat().map((arg) => (arg instanceof Error ? arg.message : String(arg))).join(' ');
    expect(text).toContain('rate_limit_exceeded');
    expect(text).not.toContain('alice@example.com');
    expect(text).not.toContain('the-token');
  });

  it('never rejects when no mailer was installed either', async () => {
    setMailer(null);
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(sendPasswordResetEmail('alice@example.com', 'the-token')).resolves.toBeUndefined();

    expect(logged).toHaveBeenCalledTimes(1);
  });
});

describe('sendPasswordChangedEmail', () => {
  it('sends one plain-text notice to the address, with no link and no token in it', async () => {
    const outbox = new InMemoryMailer();
    setMailer(outbox);

    await sendPasswordChangedEmail('alice@example.com');

    expect(outbox.sent).toHaveLength(1);
    expect(outbox.sent[0]).toMatchObject({ to: 'alice@example.com', subject: 'Your password was changed' });
    expect(outbox.sent[0]!.text).not.toContain('http');
    expect(outbox.sent[0]!.text).not.toContain('token');
  });

  it('never rejects: a failed send is logged', async () => {
    setMailer({ send: () => Promise.reject(new Error('provider is down')) });
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(sendPasswordChangedEmail('alice@example.com')).resolves.toBeUndefined();

    expect(logged).toHaveBeenCalledTimes(1);
  });
});
