import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

// requireUserAuth itself is covered through the routes; this is the adapter only, so the session
// lookup behind the module is replaced and no database is needed.
vi.mock('../../src/middlewares/SessionCookie', () => ({ getSessionUser: vi.fn() }));

import { hasUser, withUser } from '../../src/middlewares/UserSessionAuth';

const fakeRequest = (fields: object = {}) => fields as unknown as Request;
const fakeResponse = () => ({}) as unknown as Response;

describe('hasUser', () => {
  it('is true for a request requireUserAuth has put a user on, false for one without', () => {
    expect(hasUser(fakeRequest({ user: { id: 1 } }))).toBe(true);
    expect(hasUser(fakeRequest())).toBe(false);
  });
});

describe('withUser', () => {
  it('hands the request, the response and next to the handler', async () => {
    const handler = vi.fn();
    const req = fakeRequest({ user: { id: 1 } });
    const res = fakeResponse();
    const next: NextFunction = vi.fn();

    await withUser(handler)(req, res, next);

    expect(handler).toHaveBeenCalledWith(req, res, next);
    expect(next).not.toHaveBeenCalled();
  });

  it('fails the request with an error, and never runs the handler, when requireUserAuth was not mounted before it', async () => {
    const handler = vi.fn();
    const next: NextFunction = vi.fn();

    await withUser(handler)(fakeRequest(), fakeResponse(), next);

    expect(handler).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('requireUserAuth') }));
  });

  it('lets a failing async handler reject, which Express 5 turns into the error handler', async () => {
    const handler = vi.fn().mockRejectedValue(new Error('boom'));

    await expect(withUser(handler)(fakeRequest({ user: { id: 1 } }), fakeResponse(), vi.fn())).rejects.toThrow('boom');
  });
});
