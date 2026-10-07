import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createConsoleMailer,
  createMailerFromConfig,
  createResendMailer,
  getMailer,
  setMailer,
  type MailSettings,
} from '../../src/lib/mailer';

const mail = {
  to: 'john@example.com',
  subject: 'Verify your email',
  text: 'Open this link to verify your email: http://localhost:5173/verify-email#token=abc',
};

const valid: MailSettings = {
  NODE_ENV: 'development',
  MAIL_TRANSPORT: 'console',
  RESEND_API_KEY: '',
  MAIL_FROM: '',
};

const resendSettings: MailSettings = {
  NODE_ENV: 'production',
  MAIL_TRANSPORT: 'resend',
  RESEND_API_KEY: 're_test_key',
  MAIL_FROM: 'Message App <no-reply@example.com>',
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('createMailerFromConfig', () => {
  it.each([
    ['an unknown transport', { MAIL_TRANSPORT: 'smtp' }, /MAIL_TRANSPORT must be "console" or "resend"/],
    ['an empty transport', { MAIL_TRANSPORT: '' }, /MAIL_TRANSPORT must be "console" or "resend"/],
    [
      'the console transport in production',
      { NODE_ENV: 'production', MAIL_TRANSPORT: 'console' },
      /must be "resend" when NODE_ENV=production/,
    ],
    ['resend without an API key', { ...resendSettings, RESEND_API_KEY: '' }, /RESEND_API_KEY is required/],
    ['resend with a blank API key', { ...resendSettings, RESEND_API_KEY: '   ' }, /RESEND_API_KEY is required/],
    ['resend without a sender', { ...resendSettings, MAIL_FROM: '' }, /MAIL_FROM is required/],
    ['resend with a blank sender', { ...resendSettings, MAIL_FROM: '  ' }, /MAIL_FROM is required/],
  ])('refuses %s, so the server stops at startup', (_name, overrides, message) => {
    expect(() => createMailerFromConfig({ ...valid, ...overrides })).toThrow(message);
  });

  it.each([
    ['console in development', { NODE_ENV: 'development' }],
    ['console in test', { NODE_ENV: 'test' }],
    ['resend in production', resendSettings],
    ['resend in development', { ...resendSettings, NODE_ENV: 'development' }],
  ])('accepts %s', (_name, overrides) => {
    expect(() => createMailerFromConfig({ ...valid, ...overrides })).not.toThrow();
  });

  it('builds the console mailer for the console transport: the mail is logged, not sent', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    await createMailerFromConfig(valid).send(mail);

    expect(log).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('builds a mailer that sends through Resend, with the key and sender it was given (trimmed)', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(Response.json({ id: 'email-1' }));
    vi.stubGlobal('fetch', fetchSpy);

    await createMailerFromConfig({
      ...resendSettings,
      RESEND_API_KEY: '  re_test_key\n',
      MAIL_FROM: ' Message App <no-reply@example.com> ',
    }).send(mail);

    const [, init] = fetchSpy.mock.calls[0]!;
    expect(init.headers.get('Authorization')).toBe('Bearer re_test_key');
    expect(JSON.parse(init.body).from).toBe('Message App <no-reply@example.com>');
  });
});

describe('createConsoleMailer', () => {
  it('logs the recipient, the subject and the whole text (so a link can be copied from the log)', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    await createConsoleMailer().send(mail);

    expect(log).toHaveBeenCalledTimes(1);
    const printed = String(log.mock.calls[0]![0]);
    expect(printed).toContain(`To: ${mail.to}`);
    expect(printed).toContain(`Subject: ${mail.subject}`);
    expect(printed).toContain(mail.text);
  });
});

// These run the real Resend SDK against a stubbed fetch, so they check the
// request it really builds and how it really reports a failure.
describe('createResendMailer', () => {
  const mailer = () => createResendMailer({ apiKey: 're_test_key', from: 'Message App <no-reply@example.com>' });

  beforeEach(() => {
    // The SDK prints every API error itself when NODE_ENV is not production.
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('posts the mail to the Resend API with the key, the sender, the recipient, the subject and the text', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(Response.json({ id: 'email-1' }));
    vi.stubGlobal('fetch', fetchSpy);

    await expect(mailer().send(mail)).resolves.toBeUndefined();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.method).toBe('POST');
    expect(init.headers.get('Authorization')).toBe('Bearer re_test_key');
    expect(JSON.parse(init.body)).toEqual({
      from: 'Message App <no-reply@example.com>',
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
    });
  });

  it('rejects when Resend refuses the mail, because the SDK itself resolves with an error instead of throwing', async () => {
    const refusal = {
      statusCode: 403,
      name: 'validation_error',
      message: 'You can only send testing emails to your own email address.',
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(refusal, { status: 403 })));

    const failure = await mailer()
      .send(mail)
      .then(
        () => null,
        (err: unknown) => err
      );

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain('validation_error');
    expect((failure as Error).message).toContain('HTTP 403');
    expect((failure as Error).message).toContain(refusal.message);
    expect((failure as Error).message).not.toContain(mail.to);
    expect((failure as Error).cause).toMatchObject(refusal);
  });

  it('rejects when the answer is not JSON (a gateway error page)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>Bad gateway</html>', { status: 502 })));

    await expect(mailer().send(mail)).rejects.toThrow(/HTTP 502/);
  });

  it('rejects when the network fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));

    await expect(mailer().send(mail)).rejects.toThrow(/application_error/);
  });
});

describe('getMailer / setMailer', () => {
  afterEach(() => setMailer(null));

  it('throws when no mailer was set, instead of falling back to one that logs', () => {
    setMailer(null);

    expect(() => getMailer()).toThrow(/No mailer is set/);
  });

  it('returns the mailer that was set, and a later one replaces it', async () => {
    const first = { send: vi.fn().mockResolvedValue(undefined) };
    const second = { send: vi.fn().mockResolvedValue(undefined) };

    setMailer(first);
    expect(getMailer()).toBe(first);
    setMailer(second);
    await getMailer().send(mail);

    expect(first.send).not.toHaveBeenCalled();
    expect(second.send).toHaveBeenCalledWith(mail);
  });
});
