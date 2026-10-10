import config from '../../config/config';
import { buildTokenLink, checkFrontendPageUrl } from '../../lib/frontendLink';
import { getMailer } from '../../lib/mailer';

// The mail side of the password reset: what the link looks like, what the two
// mails say, and handing them to the mailer. No database and no Express in
// here, so it is tested without either. The tokens themselves are made and
// checked by passwordReset.service.ts.

/** The settings (a subset of config.ts) that the password reset depends on. */
export interface PasswordResetSettings {
  NODE_ENV: string;
  PASSWORD_RESET_URL: string;
  PASSWORD_RESET_TTL_MS: number;
}

// A reset link takes over the account, so it must not outlive a day: a longer
// lifetime is a typo in the unit.
const MAX_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Throws on a setting that cannot work, so a bad deployment stops at startup
 * instead of mailing links that never open. Call it from server.ts only, like
 * checkEmailVerificationSettings.
 */
export function checkPasswordResetSettings(settings: PasswordResetSettings): void {
  const ttl = settings.PASSWORD_RESET_TTL_MS;
  if (!Number.isInteger(ttl) || ttl < 1 || ttl > MAX_TTL_MS) {
    throw new Error(`PASSWORD_RESET_TTL_MS must be a whole number of milliseconds between 1 and ${MAX_TTL_MS}`);
  }

  checkFrontendPageUrl({
    name: 'PASSWORD_RESET_URL',
    value: settings.PASSWORD_RESET_URL,
    nodeEnv: settings.NODE_ENV,
    purpose: 'asks for the new password',
    example: 'https://yourdomain.com/reset-password',
  });
}

/**
 * Mails the reset link. Never rejects: a request does not wait for its mail,
 * so by the time this runs the response is already sent, and a provider outage
 * must not turn into an unhandled rejection. A failure is logged (the mailer's
 * errors do not contain the address) and the mail is lost; the user asks again.
 *
 * Call it after responding, never before.
 */
export async function sendPasswordResetEmail(to: string, token: string): Promise<void> {
  try {
    await getMailer().send({
      to,
      subject: 'Reset your password',
      text: `Open this link to choose a new password for your Message App account, or ignore this mail if you did not ask for one: ${buildTokenLink(config.PASSWORD_RESET_URL, token)}`,
    });
  } catch (error) {
    console.error('Could not send the password reset email:', error);
  }
}

/**
 * Mails the notice that the password was just changed through a reset link,
 * so a takeover does not go unnoticed. Never rejects, and is called after
 * responding, like sendPasswordResetEmail.
 */
export async function sendPasswordChangedEmail(to: string): Promise<void> {
  try {
    await getMailer().send({
      to,
      subject: 'Your password was changed',
      text: 'The password of your Message App account was just changed and every session was signed out; if that was not you, ask for a new password reset right away.',
    });
  } catch (error) {
    console.error('Could not send the password changed email:', error);
  }
}
