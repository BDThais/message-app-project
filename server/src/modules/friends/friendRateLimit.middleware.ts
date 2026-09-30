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
  message: { error: 'Too many searches, try again later' },
});

// Sending a request notifies another person, so it is capped to keep it from
// being used to spam. Like the search limiter, every request that gets past
// requireUserAuth counts, including ones answered with a 400 or 409.
export const friendRequestLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  keyGenerator: (req) => String(req.user!.id),
  message: { error: 'Too many friend requests, try again later' },
});
