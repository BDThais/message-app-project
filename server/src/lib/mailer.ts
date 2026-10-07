import { Resend } from 'resend';

export interface MailMessage {
  to: string;
  subject: string;
  /** Plain text only: one sentence of context and the link. */
  text: string;
}

/**
 * Whatever delivers mail. Features depend on this interface, never on a
 * provider, so the provider can be replaced by writing one more factory.
 * `send` rejects when the mail could not be handed over.
 */
export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

/** The settings (a subset of config.ts) that decide which mailer is built. */
export interface MailSettings {
  NODE_ENV: string;
  MAIL_TRANSPORT: string;
  RESEND_API_KEY: string;
  MAIL_FROM: string;
}

/**
 * Sends nothing: prints the mail to the server log, so a link or token can be
 * copied from there during development. Never use it in production, where it
 * would write secrets to the log (createMailerFromConfig refuses it).
 */
export function createConsoleMailer(): Mailer {
  return {
    async send({ to, subject, text }) {
      console.log(
        `--- mail (console transport, not sent) ---\nTo: ${to}\nSubject: ${subject}\n\n${text}\n--- end of mail ---`
      );
    },
  };
}

/**
 * Sends through Resend's HTTP API.
 *
 * The Resend SDK does not throw when the API refuses a mail (or when the
 * network fails): `emails.send` resolves to `{ data, error }`. Checking
 * `error` here is what makes a failed send a rejected promise instead of a
 * mail that silently never arrives.
 */
export function createResendMailer({ apiKey, from }: { apiKey: string; from: string }): Mailer {
  const client = new Resend(apiKey);

  return {
    async send({ to, subject, text }) {
      const { error } = await client.emails.send({ from, to, subject, text });
      if (error) {
        const status = error.statusCode === null ? '' : `, HTTP ${error.statusCode}`;
        throw new Error(`Resend could not send the email (${error.name}${status}): ${error.message}`, {
          cause: error,
        });
      }
    },
  };
}

/**
 * Builds the mailer the settings ask for, and throws on a setting that cannot
 * work, so a bad deployment stops at startup instead of failing on the first
 * mail. Call it from server.ts only, like the cleanup job.
 */
export function createMailerFromConfig(settings: MailSettings): Mailer {
  const transport = settings.MAIL_TRANSPORT;
  if (transport !== 'console' && transport !== 'resend') {
    throw new Error(`MAIL_TRANSPORT must be "console" or "resend", got "${transport}"`);
  }
  if (settings.NODE_ENV === 'production' && transport !== 'resend') {
    throw new Error(
      'MAIL_TRANSPORT must be "resend" when NODE_ENV=production: the console transport only logs mails, so nobody would receive them'
    );
  }
  if (transport === 'console') {
    return createConsoleMailer();
  }

  const apiKey = settings.RESEND_API_KEY.trim();
  const from = settings.MAIL_FROM.trim();
  if (!apiKey) {
    throw new Error('RESEND_API_KEY is required when MAIL_TRANSPORT=resend');
  }
  if (!from) {
    throw new Error('MAIL_FROM is required when MAIL_TRANSPORT=resend (for example "Message App <no-reply@yourdomain.com>")');
  }
  return createResendMailer({ apiKey, from });
}

let mailer: Mailer | null = null;

/**
 * Installs the mailer that getMailer returns: server.ts at startup, and the
 * test setup (an in-memory outbox). `null` removes it.
 */
export function setMailer(next: Mailer | null): void {
  mailer = next;
}

/**
 * The installed mailer. Throws when there is none instead of falling back to
 * the console one, so a process that forgot to set it up can never print
 * tokens to the log by accident.
 */
export function getMailer(): Mailer {
  if (!mailer) {
    throw new Error('No mailer is set: call setMailer(createMailerFromConfig(config)) at startup');
  }
  return mailer;
}
