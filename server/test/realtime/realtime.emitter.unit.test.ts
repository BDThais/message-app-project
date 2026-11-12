import { afterEach, describe, expect, it, vi } from 'vitest';
import { emitMessageNew, setRealtimeServer } from '../../src/modules/realtime/realtime.emitter';
import type { RealtimeServer } from '../../src/modules/realtime/realtime.server';
import type { Message } from '../../src/contract/types';

const message: Message = {
  id: 1,
  chatId: 5,
  senderId: 2,
  content: 'Hi',
  createdAt: '2026-11-10T00:00:00.000Z',
  editedAt: null,
  deletedAt: null,
  sender: { id: 2, name: 'Bob', avatarUrl: null },
};

afterEach(() => {
  setRealtimeServer(null);
  vi.restoreAllMocks();
});

describe('the emitter', () => {
  it('does nothing without a server, so the REST endpoints work on their own', () => {
    expect(() => emitMessageNew(message)).not.toThrow();
  });

  it('addresses the room of the chat', () => {
    const emit = vi.fn();
    const to = vi.fn(() => ({ emit }));
    setRealtimeServer({ to } as unknown as RealtimeServer);

    emitMessageNew(message);

    expect(to).toHaveBeenCalledWith('chat:5');
    expect(emit).toHaveBeenCalledWith('message:new', { message });
  });

  it('logs a failure instead of throwing: the write it reports has been committed', () => {
    const error = new Error('adapter is down');
    setRealtimeServer({
      to: () => {
        throw error;
      },
    } as unknown as RealtimeServer);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => emitMessageNew(message)).not.toThrow();
    expect(log).toHaveBeenCalledWith('Error sending a real-time event:', error);
  });
});
