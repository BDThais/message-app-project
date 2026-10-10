import { describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../../src/app';
import { createVerifiedUser } from '../helpers/passwordReset';

// The per-email limiter keeps its count for as long as the module is loaded, and so does the per-IP
// one that runs before it (10 requests): this file sends 9 requests to the route. The rule for how
// the key is made (case, a body without an address, the IP) is tested in accountRateLimit.unit.test.ts.
const route = '/account/password/reset-request';
const limited = { error: 'Too many password reset requests, try again later' };

describe('POST /account/password/reset-request (rate limit per email)', () => {
  it('answers 429 from the 4th request for one address in the hour, the same for an address with an account and one without, whatever the case', async () => {
    const alice = await createVerifiedUser('Alice');

    for (let i = 0; i < 3; i++) {
      const known = await request(app).post(route).send({ email: alice.email });
      const unknown = await request(app).post(route).send({ email: 'ghost@example.com' });
      expect(known.status, `request ${i + 1} for a known address`).toBe(202);
      expect(unknown.status, `request ${i + 1} for an unknown address`).toBe(202);
    }
    const known = await request(app).post(route).send({ email: alice.email.toUpperCase() });
    const unknown = await request(app).post(route).send({ email: 'Ghost@Example.com' });
    // Every other address has a budget of its own.
    const another = await request(app).post(route).send({ email: 'another@example.com' });

    expect(known.status).toBe(429);
    expect(known.body).toEqual(limited);
    expect(unknown.status).toBe(429);
    expect(unknown.body).toEqual(limited);
    expect(another.status).toBe(202);
  });
});
