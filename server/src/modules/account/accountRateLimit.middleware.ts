import rateLimit from 'express-rate-limit';

// Limiters for the account routes. Login is the only one so far; it is keyed by
// IP (the default) because nobody is signed in yet at that point.
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  message: { error: 'Too many attempts, try again later' },
});
