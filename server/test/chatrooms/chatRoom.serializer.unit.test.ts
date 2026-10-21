import { describe, expect, it } from 'vitest';
import { toChatRoomCore, toChatRoomSummary, toCreatedChatRoom, toMessage } from '../../src/modules/chatrooms/chatRoom.serializer';

const created = new Date('2026-09-13T12:00:00.000Z');
const later = new Date('2026-09-14T08:30:15.123Z');

// What JSON.stringify makes of a value: if the serializer left a Date in, the round trip changes it.
const overTheWire = (value: unknown) => JSON.parse(JSON.stringify(value));

describe('toChatRoomSummary', () => {
  const room = {
    id: 7,
    type: 'group' as const,
    name: 'Project chat',
    avatarUrl: null,
    createdAt: created,
    lastMessage: { content: 'See you', createdAt: later },
    unreadCount: 3,
  };

  it('turns both timestamps into ISO 8601 strings', () => {
    expect(toChatRoomSummary(room)).toEqual({
      ...room,
      createdAt: '2026-09-13T12:00:00.000Z',
      lastMessage: { content: 'See you', createdAt: '2026-09-14T08:30:15.123Z' },
    });
  });

  it('keeps a room without messages as lastMessage: null', () => {
    expect(toChatRoomSummary({ ...room, lastMessage: null }).lastMessage).toBeNull();
  });

  it('leaves nothing that JSON would change (no Date)', () => {
    const summary = toChatRoomSummary(room);

    expect(overTheWire(summary)).toEqual(summary);
  });

  it('names its fields: a property the service data happens to carry is not sent', () => {
    const summary = toChatRoomSummary({ ...room, emptiedAt: created } as typeof room);

    expect(Object.keys(summary).sort()).toEqual(['avatarUrl', 'createdAt', 'id', 'lastMessage', 'name', 'type', 'unreadCount']);
  });
});

describe('toChatRoomCore and toCreatedChatRoom', () => {
  const row = { id: 7, type: 'direct' as const, name: null, avatarUrl: null, createdAt: created, emptiedAt: null };
  const member = { chatId: 7, role: 'admin' as const, lastReadMessageId: null, member: { id: 1, name: 'Alice', avatarUrl: null } };

  it('gives the five columns of the room, with the timestamp as a string', () => {
    expect(toChatRoomCore(row)).toEqual({ id: 7, type: 'direct', name: null, avatarUrl: null, createdAt: '2026-09-13T12:00:00.000Z' });
  });

  it('adds the members as they are, and never the cleanup job\'s emptiedAt', () => {
    const room = toCreatedChatRoom({ ...row, members: [member] });

    expect(room).toEqual({ id: 7, type: 'direct', name: null, avatarUrl: null, createdAt: '2026-09-13T12:00:00.000Z', members: [member] });
    expect(overTheWire(room)).toEqual(room);
  });
});

describe('toMessage', () => {
  const message = {
    id: 42,
    chatId: 7,
    senderId: 1,
    content: 'Hello!',
    createdAt: created,
    editedAt: later,
    deletedAt: null,
    sender: { id: 1, name: 'Alice', avatarUrl: 'https://example.com/a.png' },
  };

  it('turns the three timestamps into strings, a missing one stays null', () => {
    expect(toMessage(message)).toEqual({
      ...message,
      createdAt: '2026-09-13T12:00:00.000Z',
      editedAt: '2026-09-14T08:30:15.123Z',
      deletedAt: null,
    });
  });

  it('keeps the shape of a message whose author deleted their account', () => {
    const orphan = toMessage({ ...message, senderId: null, sender: null });

    expect(orphan.senderId).toBeNull();
    expect(orphan.sender).toBeNull();
    expect(overTheWire(orphan)).toEqual(orphan);
  });

  it('writes the same string JSON.stringify writes for the Date', () => {
    expect(toMessage(message).createdAt).toBe(JSON.parse(JSON.stringify(created)));
  });

  it('names its fields: an extra column on the row is not sent', () => {
    const sent = toMessage({ ...message, ipAddress: '10.0.0.1' } as typeof message);

    expect(sent).not.toHaveProperty('ipAddress');
    expect(Object.keys(sent).sort()).toEqual(['chatId', 'content', 'createdAt', 'deletedAt', 'editedAt', 'id', 'sender', 'senderId']);
  });
});
