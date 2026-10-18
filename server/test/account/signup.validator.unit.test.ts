import { describe, expect, it } from 'vitest';
import { validateAccountBody } from '../../src/modules/account/signup.validator';

// No database. The status codes, the duplicate checks and the stored forms are in signup.test.ts.

const body = { name: 'johndoe', email: 'John.Doe@Example.com', tel: '+14155552671', password: 'Str0ng!Pass' };
const required = { valid: false, message: 'All fields are required' };

describe('validateAccountBody', () => {
  it('accepts a good body and hands the fields on as they were sent', () => {
    expect(validateAccountBody(body)).toEqual({ valid: true, data: body });
  });

  // Express leaves req.body undefined when the request has no JSON body, and a JSON body can be
  // anything: none of these may throw.
  it.each([
    ['undefined (no JSON body)', undefined],
    ['null', null],
    ['a string', 'hello'],
    ['a number', 42],
    ['an array', [body]],
    ['an empty object', {}],
  ])('asks for all the fields when the body is %s', (_label, input) => {
    expect(validateAccountBody(input)).toEqual(required);
  });

  it.each(['name', 'email', 'tel', 'password'] as const)('counts %s as missing when it is empty, or not a string', (field) => {
    for (const value of ['', 123, true, null, ['x'], { a: 1 }]) {
      expect(validateAccountBody({ ...body, [field]: value }), `${field}: ${JSON.stringify(value)}`).toEqual(required);
    }
  });

  it('checks the fields in the order name, email, phone number, password: the first rule that fails is the answer', () => {
    const allBad = { name: 'john doe', email: 'nope', tel: '123', password: 'weak' };

    expect(validateAccountBody(allBad)).toEqual({ valid: false, message: 'Name must contain only letters and numbers' });
    expect(validateAccountBody({ ...allBad, name: 'johndoe' })).toEqual({ valid: false, message: 'Invalid email format' });
    expect(validateAccountBody({ ...allBad, name: 'johndoe', email: body.email })).toEqual({
      valid: false,
      message: 'Invalid phone number format',
    });
    expect(validateAccountBody({ ...allBad, name: 'johndoe', email: body.email, tel: body.tel })).toEqual({
      valid: false,
      message: 'Password must be at least 8 characters long',
    });
  });
});
