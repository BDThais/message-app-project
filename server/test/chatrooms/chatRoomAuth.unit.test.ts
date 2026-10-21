import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

// The adapters of the membership middleware, with the session lookup and the service behind
// loadChatMembership replaced: no database is needed.
vi.mock('../../src/middlewares/SessionCookie', () => ({ getSessionUser: vi.fn() }));
const service = vi.hoisted(() => ({ getChatMembership: vi.fn() }));
vi.mock('../../src/modules/chatrooms/chatRoom.service', () => service);

import { loadChatMembership, withChatMembership } from '../../src/modules/chatrooms/chatRoomAuth.middleware';

const fakeRequest = (fields: object = {}) => fields as unknown as Request;
const fakeResponse = () => ({ status: vi.fn(), json: vi.fn() }) as unknown as Response & { status: ReturnType<typeof vi.fn> };
const membership = { chatId: 5, role: 'admin', roomType: 'group' };

describe('withChatMembership', () => {
  it('runs the handler for a request that has a user and a membership', async () => {
    const handler = vi.fn();
    const req = fakeRequest({ user: { id: 1 }, chatMembership: membership });
    const res = fakeResponse();
    const next: NextFunction = vi.fn();

    await withChatMembership(handler)(req, res, next);

    expect(handler).toHaveBeenCalledWith(req, res, next);
  });

  it("fails the request with an error when the router has no router.param('chatid', loadChatMembership)", async () => {
    const handler = vi.fn();
    const next: NextFunction = vi.fn();

    await withChatMembership(handler)(fakeRequest({ user: { id: 1 } }), fakeResponse(), next);

    expect(handler).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('loadChatMembership') }));
  });

  it('fails the request with an error when there is no user either', async () => {
    const handler = vi.fn();
    const next: NextFunction = vi.fn();

    await withChatMembership(handler)(fakeRequest({ chatMembership: membership }), fakeResponse(), next);

    expect(handler).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('requireUserAuth') }));
  });
});

describe('loadChatMembership', () => {
  it('fails the request with an error, before looking anything up, when requireUserAuth was not mounted before it', async () => {
    const res = fakeResponse();
    const next: NextFunction = vi.fn();

    await loadChatMembership(fakeRequest(), res, next, '5');

    expect(service.getChatMembership).not.toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('requireUserAuth') }));
  });
});
