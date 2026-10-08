import config from '../../config/config';
import { getMailer } from '../../lib/mailer';

// The mail side of email verification: what the link looks like, what the mail
// says, and handing it to the mailer. No database and no Express in here, so
// it is tested without either. The tokens themselves are made and checked by
// emailVerification.service.ts.

/** The settings (a subset of config.ts) that email verification depends on. */
export interface EmailVerificationSettings {
  NODE_ENV: string;
  EMAIL_VERIFICATION_URL: string;
  EMAIL_VERIFICATION_TTL_MS: number;
}

// A link that stays valid for longer than a year is a typo in the unit.
const MAX_TTL_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * Throws on a setting that cannot work, so a bad deployment stops at startup
 * instead of mailing links that never open. Call it from server.ts only, like
 * createMailerFromConfig.
 */
export function checkEmailVerificationSettings(settings: EmailVerificationSettings): void {
  const ttl = settings.EMAIL_VERIFICATION_TTL_MS;
  if (!Number.isInteger(ttl) || ttl < 1 || ttl > MAX_TTL_MS) {
    throw new Error(`EMAIL_VERIFICATION_TTL_MS must be a whole number of milliseconds between 1 and ${MAX_TTL_MS}`);
  }

  const url = settings.EMAIL_VERIFICATION_URL.trim();
  if (!url) {
    // Only reachable in production: elsewhere config.ts supplies the development page.
    throw new Error(
      `EMAIL_VERIFICATION_URL is required${settings.NODE_ENV === 'production' ? ' when NODE_ENV=production' : ''}: ` +
        'the address of the frontend page that confirms the email (for example "https://yourdomain.com/verify-email")'
    );
  }
  // The token is added as the fragment, so the base must not have one already.
  if (url.includes('#')) {
    throw new Error('EMAIL_VERIFICATION_URL must not contain a "#": the token is added as the URL fragment');
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`EMAIL_VERIFICATION_URL is not a valid absolute URL: "${url}"`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`EMAIL_VERIFICATION_URL must be an http or https URL, got "${url}"`);
  }
}

/**
 * The link in the mail: the frontend page, with the token as a fragment
 * (`...#token=...`). A fragment is never sent to a server, so the token stays
 * out of access logs and `Referer` headers. A token is base64url, so it needs
 * no escaping.
 */
export function buildVerificationLink(baseUrl: string, token: string): string {
  return `${baseUrl.trim()}#token=${token}`;
}

/**
 * Mails the verification link. Never rejects: a request does not wait for its
 * mail, so by the time this runs the response is already sent, and a provider
 * outage must not turn into an unhandled rejection. A failure is logged (the
 * mailer's errors do not contain the address) and the mail is lost; the user
 * asks again with POST /account/email/verification.
 *
 * Call it after responding, never before.
 */
export async function sendVerificationEmail(to: string, token: string): Promise<void> {
  try {
    await getMailer().send({
      to,
      subject: 'Confirm your email address',
      text: `Open this link to confirm the email address of your Message App account: ${buildVerificationLink(config.EMAIL_VERIFICATION_URL, token)}`,
    });
  } catch (error) {
    console.error('Could not send the verification email:', error);
  }
}
