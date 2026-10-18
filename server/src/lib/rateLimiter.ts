import rateLimit, { MemoryStore, type Options } from 'express-rate-limit';

// Every rate limiter of the app is made here, so that tests can empty all of them.
//
// A limiter keeps its counts for as long as the process lives, which in a test file is every test of
// it, and supertest sends every request from the same IP: a per-IP limiter would run out of budget
// part way through a file and answer 429 to whichever test comes last. The limiters stay real (they
// are in the path of every request, in the order the routes mount them); only their counts are emptied.
const stores: MemoryStore[] = [];

/** express-rate-limit with a memory store of its own (never shared: each limiter counts for itself). */
export function createRateLimiter(options: Partial<Options>) {
  const store = new MemoryStore();
  stores.push(store);
  return rateLimit({ ...options, store });
}

/**
 * Empties the counts of every limiter, so the next test starts with full budgets; test/setup.ts calls
 * it before each test. It throws anywhere but in a test run, so it cannot lift a limit by mistake.
 */
export async function resetRateLimiters(): Promise<void> {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('resetRateLimiters is for tests only.');
  }
  await Promise.all(stores.map((store) => store.resetAll()));
}
