import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

// The controller alone, with the services replaced: only the part of getChatRoomById that the
// integration tests cannot reach (the room disappearing after the membership check) is here.
const services = vi.hoisted(() => ({
  getDirectChatRoomsForUser: vi.fn(),
  getGroupChatRoomsForUser: vi.fn(),
}));
vi.mock('../../src/modules/chatrooms/chatRoom.service', () => services);
vi.mock('../../src/modules/chatrooms/chatMember.service', () => ({}));
vi.mock('../../src/modules/chatrooms/message.service', () => ({}));

import { getChatRoomById } from '../../src/modules/chatrooms/chatRoom.controller';

function fakeResponse() {
  const res = { status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res;
}

const request = (roomType: 'direct' | 'group') =>
  ({ user: { id: 1 }, chatMembership: { chatId: 5, roomType, role: 'admin' } }) as unknown as Request;

const summary = {
  id: 5,
  type: 'group',
  name: 'Project chat',
  avatarUrl: null,
  createdAt: new Date('2026-09-13T12:00:00.000Z'),
  lastMessage: null,
  unreadCount: 0,
};

describe('getChatRoomById', () => {
  it('answers 404 when the room is gone by the time it is read (deleted after loadChatMembership)', async () => {
    services.getGroupChatRoomsForUser.mockResolvedValue([]);
    const res = fakeResponse();

    await getChatRoomById(request('group'), res as unknown as Response, vi.fn());

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Chat room not found' });
  });

  it('asks only the fetcher of the room\'s type, and adds the requester\'s role to the summary', async () => {
    services.getGroupChatRoomsForUser.mockResolvedValue([summary]);
    services.getDirectChatRoomsForUser.mockClear();
    const res = fakeResponse();

    await getChatRoomById(request('group'), res as unknown as Response, vi.fn());

    expect(services.getDirectChatRoomsForUser).not.toHaveBeenCalled();
    expect(services.getGroupChatRoomsForUser).toHaveBeenCalledWith(1, 5);
    expect(res.json).toHaveBeenCalledWith({ chatRoom: { ...summary, createdAt: '2026-09-13T12:00:00.000Z', role: 'admin' } });
  });
});
