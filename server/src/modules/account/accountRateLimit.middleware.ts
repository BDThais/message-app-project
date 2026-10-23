import { ipKeyGenerator } from 'express-rate-limit';
import { normalizeEmail } from '../../lib/emailAddress';
import { createRateLimiter } from '../../lib/rateLimiter';
import { isRecord } from '../../lib/validation';
import { userKey } from '../../middlewares/UserSessionAuth';

// Limiters for the account routes. Login is keyed by IP (the default) because
// nobody is signed in yet at that point.
export const loginLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  message: { error: 'Too many attempts, try again later' },
});

// Changing the password and deleting the account both ask for the current
// one, so a stolen session cookie could otherwise be used to guess the
// password with no limit, which is exactly what loginLimiter prevents on
// POST /account/login. Per user, so it has to be mounted after requireUserAuth.
// One limiter instance serves both routes on purpose, so they share a single
// budget of guesses instead of one each. Every request that gets past
// requireUserAuth counts, including ones answered with a 400.
export const passwordCheckLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  keyGenerator: userKey,
  message: { error: 'Too many attempts, try again later' },
});

// Using a verification link needs no session (the token is the credential), so
// like login it is keyed by IP. The token is 256 random bits and cannot be
// guessed, so this is not what protects it: it only keeps one client from
// hammering the endpoint. Every request counts, including ones answered with a 400.
export const emailVerifyLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  message: { error: 'Too many attempts, try again later' },
});

// Asking for a verification mail sends a mail, so it is capped per user (the
// 60-second cooldown in the service spaces the mails out; this caps how many
// there are). Mount it after requireUserAuth. Every request that gets past
// requireUserAuth counts, including ones answered with a 409 or the cooldown's 429.
export const emailVerificationRequestLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  keyGenerator: userKey,
  message: { error: 'Too many verification emails requested, try again later' },
});

// The password reset needs no session either (a user who forgot the password cannot sign in), so
// its limiters are keyed by what the request carries, not by user.
//
// Asking for a link: two limiters, mounted in this order. Both count every request, whether the
// address has an account or not and whether the body is valid, so a 429 reveals nothing about who
// is registered.
//
// Per IP: keeps one client from trying many addresses.
export const passwordResetRequestIpLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  message: { error: 'Too many attempts, try again later' },
});

// An address is long enough to be a key; anything longer cannot be one (validator.isEmail refuses
// it anyway) and must not be stored in the limiter as one.
const MAX_EMAIL_LENGTH = 254;

// Per email: keeps anyone from filling one inbox with reset links, from any number of IPs. The key
// is the address from the body in its canonical form (normalizeEmail, the one the account lookup
// uses: "John@x.com" and "john@x.com" are one account and share one budget), and the client's IP
// when the body has no usable address. The two kinds of key have prefixes, so an address that looks
// like an IP cannot use up that IP's budget.
export function passwordResetEmailKey(req: { body?: unknown; ip?: string | undefined }): string {
  const email = isRecord(req.body) ? req.body.email : undefined;
  if (typeof email === 'string' && email.length <= MAX_EMAIL_LENGTH) return `email:${normalizeEmail(email)}`;

  return `ip:${ipKeyGenerator(req.ip ?? '')}`;
}

export const passwordResetRequestEmailLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  limit: 3,
  keyGenerator: passwordResetEmailKey,
  message: { error: 'Too many password reset requests, try again later' },
});

// Using a reset link: like email verification, the token is the credential and it cannot be
// guessed, so this only keeps one client from hammering the endpoint. Every request counts,
// including ones answered with a 400.
export const passwordResetLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  message: { error: 'Too many attempts, try again later' },
});
