import { describe, expect, it } from 'vitest';
import { bodyFields } from '../../src/lib/validation';

describe('bodyFields', () => {
  it('gives the fields of a JSON object body, unchecked', () => {
    const { token, new_password } = bodyFields<{ token: string; new_password: string }>({ token: 7, new_password: 'x', extra: true });

    expect(token).toBe(7);
    expect(new_password).toBe('x');
  });

  // Express leaves req.body undefined when the request has no JSON body, and a body can be any JSON value.
  it.each([undefined, null, 'text', 42, true])('gives no fields for %s', (body) => {
    const { email } = bodyFields<{ email: string }>(body);

    expect(email).toBeUndefined();
  });
});
