import rateLimit from 'express-rate-limit';

// Per-user limiters (keyed by user id, not IP) for the friend routes. They
// read req.user, which requireUserAuth sets, so mount them after it.

// Phone lookup lets a signed-in user test whether a number is registered, so
// it is capped to keep it from being used to scan numbers. Every request that
// gets past requireUserAuth counts, including ones answered with a 400.
export const friendSearchLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  keyGenerator: (req) => String(req.user!.id),
  message: { message: 'Too many searches, try again later' },
});
