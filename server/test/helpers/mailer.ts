import type { MailMessage, Mailer } from '../../src/lib/mailer';

/**
 * A mailer that keeps what it was asked to send instead of sending it. The
 * test setup installs `outbox` as the app's mailer and empties it before
 * every test, so a test reads `outbox.sent` to see exactly the mails its own
 * requests caused.
 */
export class InMemoryMailer implements Mailer {
  sent: MailMessage[] = [];

  async send(message: MailMessage): Promise<void> {
    this.sent.push({ ...message });
  }

  clear(): void {
    this.sent = [];
  }
}

export const outbox = new InMemoryMailer();
