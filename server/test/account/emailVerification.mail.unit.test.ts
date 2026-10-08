import { afterEach, describe, expect, it, vi } from 'vitest';
import config from '../../src/config/config';
import { setMailer } from '../../src/lib/mailer';
import type { Mailer } from '../../src/lib/mailer';
import {
  buildVerificationLink,
  checkEmailVerificationSettings,
  sendVerificationEmail,
} from '../../src/modules/account/emailVerification.mail';
import { InMemoryMailer } from '../helpers/mailer';

const goodSettings = {
  NODE_ENV: 'production',
  EMAIL_VERIFICATION_URL: 'https://app.example.com/verify-email',
  EMAIL_VERIFICATION_TTL_MS: 24 * 60 * 60 * 1000,
};

afterEach(() => {
  setMailer(null);
  vi.restoreAllMocks();
});

describe('checkEmailVerificationSettings', () => {
  it('accepts a good production setup and the development defaults', () => {
    expect(() => checkEmailVerificationSettings(goodSettings)).not.toThrow();
    expect(() =>
      checkEmailVerificationSettings({
        NODE_ENV: 'development',
        EMAIL_VERIFICATION_URL: 'http://localhost:5173/verify-email',
        EMAIL_VERIFICATION_TTL_MS: 86_400_000,
      })
    ).not.toThrow();
  });

  it('accepts a URL with a query string, and the longest and shortest lifetimes', () => {
    expect(() =>
      checkEmailVerificationSettings({ ...goodSettings, EMAIL_VERIFICATION_URL: 'https://app.example.com/verify?lang=en' })
    ).not.toThrow();
    expect(() => checkEmailVerificationSettings({ ...goodSettings, EMAIL_VERIFICATION_TTL_MS: 1 })).not.toThrow();
    expect(() => checkEmailVerificationSettings({ ...goodSettings, EMAIL_VERIFICATION_TTL_MS: 365 * 24 * 60 * 60 * 1000 })).not.toThrow();
  });

  it.each([
    { desc: 'NaN (a mistyped number)', ttl: Number.NaN },
    { desc: 'zero', ttl: 0 },
    { desc: 'a negative number', ttl: -1 },
    { desc: 'a fraction', ttl: 1.5 },
    { desc: 'more than a year', ttl: 365 * 24 * 60 * 60 * 1000 + 1 },
    { desc: 'Infinity', ttl: Number.POSITIVE_INFINITY },
  ])('rejects a lifetime of $desc', ({ ttl }) => {
    expect(() => checkEmailVerificationSettings({ ...goodSettings, EMAIL_VERIFICATION_TTL_MS: ttl })).toThrow(
      /EMAIL_VERIFICATION_TTL_MS/
    );
  });

  it('requires the page URL in production, and says why', () => {
    expect(() => checkEmailVerificationSettings({ ...goodSettings, EMAIL_VERIFICATION_URL: '' })).toThrow(
      /EMAIL_VERIFICATION_URL is required when NODE_ENV=production/
    );
    expect(() => checkEmailVerificationSettings({ ...goodSettings, EMAIL_VERIFICATION_URL: '   ' })).toThrow(
      /EMAIL_VERIFICATION_URL is required/
    );
  });

  it.each([
    { desc: 'not a URL', url: 'verify-email', message: /not a valid absolute URL/ },
    { desc: 'a relative path', url: '/verify-email', message: /not a valid absolute URL/ },
    { desc: 'a scheme other than http(s)', url: 'javascript:alert(1)', message: /http or https/ },
    { desc: 'an ftp URL', url: 'ftp://app.example.com/verify', message: /http or https/ },
    { desc: 'a URL that already has a fragment', url: 'https://app.example.com/verify#top', message: /must not contain a "#"/ },
    { desc: 'a URL with an empty fragment', url: 'https://app.example.com/verify#', message: /must not contain a "#"/ },
  ])('rejects $desc', ({ url, message }) => {
    expect(() => checkEmailVerificationSettings({ ...goodSettings, EMAIL_VERIFICATION_URL: url })).toThrow(message);
  });
});

describe('buildVerificationLink', () => {
  it('puts the token in the URL fragment, which a browser never sends to a server', () => {
    expect(buildVerificationLink('https://app.example.com/verify-email', 'tok_en-1')).toBe(
      'https://app.example.com/verify-email#token=tok_en-1'
    );
  });

  it('keeps a query string in front of the fragment, and ignores surrounding spaces in the setting', () => {
    expect(buildVerificationLink(' https://app.example.com/verify?lang=en ', 'abc')).toBe(
      'https://app.example.com/verify?lang=en#token=abc'
    );
  });
});

describe('sendVerificationEmail', () => {
  it('sends one plain-text mail to the address, with the link and nothing else secret', async () => {
    const outbox = new InMemoryMailer();
    setMailer(outbox);

    await sendVerificationEmail('alice@example.com', 'the-token');

    expect(outbox.sent).toHaveLength(1);
    expect(outbox.sent[0]).toMatchObject({ to: 'alice@example.com', subject: 'Confirm your email address' });
    expect(outbox.sent[0].text).toContain(`${config.EMAIL_VERIFICATION_URL}#token=the-token`);
  });

  it('never rejects: a failed send is logged without the address or the token, and nothing else happens', async () => {
    const failing: Mailer = { send: () => Promise.reject(new Error('Resend could not send the email (rate_limit_exceeded, HTTP 429): slow down')) };
    setMailer(failing);
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(sendVerificationEmail('alice@example.com', 'the-token')).resolves.toBeUndefined();

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

    await expect(sendVerificationEmail('alice@example.com', 'the-token')).resolves.toBeUndefined();

    expect(logged).toHaveBeenCalledTimes(1);
  });
});
