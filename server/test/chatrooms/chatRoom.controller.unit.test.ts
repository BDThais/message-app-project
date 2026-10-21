import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

// The controller alone, with the services replaced: only the part of getChatRoomById that the
// integration tests cannot reach (the room disappearing after the membership check) is here.
const services = vi.hoisted(() => ({
  getChatRoomSummaryForUser: vi.fn(),
  updateChatRoomById: vi.fn(),
}));
vi.mock('../../src/modules/chatrooms/chatRoom.service', () => services);
vi.mock('../../src/modules/chatrooms/chatMember.service', () => ({}));
vi.mock('../../src/modules/chatrooms/message.service', () => ({}));

import { getChatRoomById, updateChatRoom } from '../../src/modules/chatrooms/chatRoom.controller';
import type { ChatRoomRequest } from '../../src/modules/chatrooms/chatRoomAuth.middleware';

function fakeResponse() {
  const res = { status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res;
}

const request = (roomType: 'direct' | 'group', body: unknown = {}) =>
  ({ user: { id: 1 }, body, chatMembership: { chatId: 5, roomType, role: 'admin' } }) as unknown as ChatRoomRequest;

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
    services.getChatRoomSummaryForUser.mockResolvedValue(undefined);
    const res = fakeResponse();

    await getChatRoomById(request('group'), res as unknown as Response, vi.fn());

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Chat room not found' });
  });

  it('asks for the room as the requester sees it, and adds their role to the summary', async () => {
    services.getChatRoomSummaryForUser.mockResolvedValue(summary);
    const res = fakeResponse();

    await getChatRoomById(request('group'), res as unknown as Response, vi.fn());

    expect(services.getChatRoomSummaryForUser).toHaveBeenCalledWith(1, 5, 'group');
    expect(res.json).toHaveBeenCalledWith({ chatRoom: { ...summary, createdAt: '2026-09-13T12:00:00.000Z', role: 'admin' } });
  });
});

describe('updateChatRoom', () => {
  it('answers 404 when the room is gone by the time the renamed room is read back', async () => {
    services.updateChatRoomById.mockResolvedValue({});
    services.getChatRoomSummaryForUser.mockResolvedValue(undefined);
    const res = fakeResponse();

    await updateChatRoom(request('group', { name: 'New name' }), res as unknown as Response, vi.fn());

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Chat room not found' });
  });
});
