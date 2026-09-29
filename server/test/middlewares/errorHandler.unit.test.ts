import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { errorHandler } from '../../src/middlewares/ErrorHandler';

// The handler alone, with a fake response: no database, no HTTP. What Express
// itself hands it (malformed JSON, broken percent-encoding) is checked end to
// end in errorHandler.test.ts.

const req = { method: 'GET', originalUrl: '/some/path' } as Request;

function fakeRes(headersSent = false) {
  const res = {
    headersSent,
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  return res as typeof res & Response;
}

function httpError(status: number, message: string, expose: boolean) {
  return Object.assign(new Error(message), { status, statusCode: status, expose });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('errorHandler', () => {
  it('answers 500 with a generic body for an unexpected error, and logs it', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = fakeRes();

    errorHandler(new Error('connection lost'), req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Internal server error' });
    expect(logged).toHaveBeenCalledOnce();
  });

  it('answers with the error\'s own 4xx status and message when it is safe to expose', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = fakeRes();

    errorHandler(httpError(400, 'Malformed body', true), req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Malformed body' });
    expect(logged).not.toHaveBeenCalled();
  });

  it('falls back to the plain status text when the message is not marked as safe to expose', () => {
    const res = fakeRes();

    errorHandler(httpError(400, 'internal detail', false), req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Bad Request' });
  });

  it.each([[500], [502], [302]])('treats a %i status on the error as an internal error', (status) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = fakeRes();

    errorHandler(httpError(status, 'boom', true), req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Internal server error' });
  });

  it('hands the error on to Express when the response has already started', () => {
    const res = fakeRes(true);
    const next = vi.fn();
    const err = new Error('too late');

    errorHandler(err, req, res, next);

    expect(next).toHaveBeenCalledWith(err);
    expect(res.status).not.toHaveBeenCalled();
  });
});
