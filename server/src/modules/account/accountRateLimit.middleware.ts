import rateLimit from 'express-rate-limit';

// Limiters for the account routes. Login is keyed by IP (the default) because
// nobody is signed in yet at that point.
export const loginLimiter = rateLimit({
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
export const passwordCheckLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  keyGenerator: (req) => String(req.user!.id),
  message: { error: 'Too many attempts, try again later' },
});

// Using a verification link needs no session (the token is the credential), so
// like login it is keyed by IP. The token is 256 random bits and cannot be
// guessed, so this is not what protects it: it only keeps one client from
// hammering the endpoint. Every request counts, including ones answered with a 400.
export const emailVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  message: { error: 'Too many attempts, try again later' },
});

// Asking for a verification mail sends a mail, so it is capped per user (the
// 60-second cooldown in the service spaces the mails out; this caps how many
// there are). Mount it after requireUserAuth. Every request that gets past
// requireUserAuth counts, including ones answered with a 409 or the cooldown's 429.
export const emailVerificationRequestLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  keyGenerator: (req) => String(req.user!.id),
  message: { error: 'Too many verification emails requested, try again later' },
});
