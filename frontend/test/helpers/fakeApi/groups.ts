import type {
  AddMembersResponse,
  ChatRoomDetailResponse,
  CreatedChatRoomResponse,
  MemberListResponse,
  MemberResponse,
} from '@contract/responses';
import type { ChatRoomDetail, CreatedChatRoom, Member, Role } from '@contract/types';
import { textField } from './body';
import { json, noContent } from './responses';
import { personById, type Body, type FakeMember, type FakeRoom, type FakeServer } from './state';

// Group rooms and their members, following api.doc.md: the permission model, the friendship rule, the
// only-admin rule and the error texts. `chats.ts` hands over what is not about messages.

const ADMIN_ONLY = 'Admin role required for this action';
const NOT_FRIENDS = 'Only your friends can be added to a chat room';

/** Who is in the room: a group lists its members, a direct room is John and the other one, a private room only John. */
export function membersOf(room: FakeRoom, state: FakeServer): FakeMember[] {
  if (room.members) return room.members;
  const me: FakeMember = { userId: state.session!.id, role: 'admin' };
  if (room.type === 'direct' && room.memberId !== undefined) return [me, { userId: room.memberId, role: 'admin' }];
  return [me];
}

function memberOf(room: FakeRoom, fake: FakeMember): Member {
  const person = personById(fake.userId)!;
  return {
    chatId: room.id,
    role: fake.role,
    lastReadMessageId: null,
    member: { id: person.id, name: person.name, avatarUrl: person.avatarUrl },
  };
}

/** Admins first, then by name with case and accents ignored. */
function sorted(room: FakeRoom, fakes: FakeMember[]): Member[] {
  return fakes
    .map((fake) => memberOf(room, fake))
    .sort(
      (a, b) =>
        Number(b.role === 'admin') - Number(a.role === 'admin') ||
        a.member.name.localeCompare(b.member.name, undefined, { sensitivity: 'base' }),
    );
}

/** The 400 text of a bad name or avatar; `create` has the texts of POST /api/chat and the other the ones of PATCH. */
function nameAndAvatarProblem(body: Body, create: boolean): string | null {
  const quote = create ? '' : "'";
  const label = (field: string) => `${quote}${field}${quote}`;
  if (body && 'name' in body) {
    const name = textField(body, 'name').trim();
    if (name === '') return `${label('name')} must be a non-empty string${create ? ' if provided' : ''}`;
    if (name.length > 100) return `${label('name')} must be 100 characters or fewer`;
  }
  if (body && 'avatar_url' in body) {
    const url = body.avatar_url;
    if (url === null && !create) return null;
    if (typeof url !== 'string')
      return `${label('avatar_url')} must be a string${create ? ' if provided' : ' or null'}`;
    if (!/^https?:\/\/\S+$/.test(url)) return `${label('avatar_url')} must be a valid URL`;
  }
  return null;
}

/** POST /api/chat for a group room: the creator is its admin, every id must be a friend, and no room is made otherwise. */
export function createGroupRoom(
  body: Body,
  state: FakeServer,
  summaryOf: (room: FakeRoom) => CreatedChatRoom,
): Response {
  const ids = body?.member_ids;
  if (ids !== undefined && !Array.isArray(ids)) return json({ error: 'member_ids must be an array of user IDs' }, 400);
  const problem = nameAndAvatarProblem(body, true);
  if (problem) return json({ error: problem }, 400);
  const me = state.session!.id;
  const memberIds = [...new Set((ids ?? []).map(Number))].filter((id) => id !== me);
  if (memberIds.some((id) => !state.friendIds.includes(id))) return json({ error: NOT_FRIENDS }, 403);

  const room = state.addRoom({
    id: Math.max(0, ...state.rooms.map(({ id }) => id)) + 1,
    type: 'group',
    name: body && 'name' in body ? textField(body, 'name').trim() : null,
    avatarUrl: typeof body?.avatar_url === 'string' ? body.avatar_url : null,
    members: [{ userId: me, role: 'admin' }, ...memberIds.map((userId) => ({ userId, role: 'member' as const }))],
  });
  const created: CreatedChatRoom = { ...summaryOf(room), members: sorted(room, room.members!) };
  return json({ chatRoom: created } satisfies CreatedChatRoomResponse, 201);
}

/** Why a group-only action is refused for this room, or null when it is a group room. */
function notAGroup(room: FakeRoom): Response | null {
  if (room.type === 'direct') return json({ error: 'Not available for direct chat rooms' }, 403);
  if (room.type === 'private') return json({ error: 'Not available for your private chat room' }, 403);
  return null;
}

/** PATCH and DELETE /api/chat/:chatid. */
export function roomEndpoints(
  method: string,
  room: FakeRoom,
  body: Body,
  state: FakeServer,
  detailOf: (room: FakeRoom) => ChatRoomDetail,
): Response | undefined {
  if (method !== 'PATCH' && method !== 'DELETE') return undefined;
  const refused = notAGroup(room);
  if (refused) return refused;
  const mine = membersOf(room, state).find(({ userId }) => userId === state.session!.id);
  if (mine?.role !== 'admin') return json({ error: ADMIN_ONLY }, 403);

  if (method === 'DELETE') {
    state.rooms.splice(state.rooms.indexOf(room), 1);
    state.messages = state.messages.filter(({ chatId }) => chatId !== room.id);
    return noContent();
  }
  if (!body || (!('name' in body) && !('avatar_url' in body))) {
    return json({ error: 'At least either Name or Avatar must be provided' }, 400);
  }
  const problem = nameAndAvatarProblem(body, false);
  if (problem) return json({ error: problem }, 400);
  if ('name' in body) room.name = textField(body, 'name').trim();
  if ('avatar_url' in body) room.avatarUrl = body.avatar_url as string | null;
  return json({ chatRoom: detailOf(room) } satisfies ChatRoomDetailResponse);
}

/** GET and POST /api/chat/:chatid/member, DELETE and PATCH /api/chat/:chatid/member/:userid. */
export function memberEndpoints(
  method: string,
  room: FakeRoom,
  userIdText: string | undefined,
  body: Body,
  state: FakeServer,
): Response | undefined {
  const me = state.session!.id;
  const fakes = membersOf(room, state);
  const mine = fakes.find(({ userId }) => userId === me);
  const isAdmin = mine?.role === 'admin';

  if (userIdText === undefined) {
    if (method === 'GET') return json({ members: sorted(room, fakes) } satisfies MemberListResponse);
    if (method !== 'POST') return undefined;
    const refused = notAGroup(room);
    if (refused) return refused;
    if (!isAdmin) return json({ error: ADMIN_ONLY }, 403);
    const ids = body?.member_ids;
    if (!Array.isArray(ids) || ids.length === 0)
      return json({ error: 'member_ids must be a non-empty array of user IDs' }, 400);
    const wanted = [...new Set(ids.map(Number))];
    const alreadyMemberIds = wanted.filter((id) => fakes.some(({ userId }) => userId === id));
    const toAdd = wanted.filter((id) => !alreadyMemberIds.includes(id));
    if (toAdd.some((id) => !state.friendIds.includes(id))) return json({ error: NOT_FRIENDS }, 403);
    const added = toAdd.map((userId) => ({ userId, role: 'member' as const }));
    room.members = [...fakes, ...added];
    return json(
      { addedMembers: sorted(room, added), alreadyMemberIds } satisfies AddMembersResponse,
      added.length > 0 ? 201 : 200,
    );
  }

  const userId = Number(userIdText);
  const target = fakes.find((fake) => fake.userId === userId);
  const others = fakes.filter((fake) => fake !== target);
  const onlyAdmin = target?.role === 'admin' && !others.some(({ role }) => role === 'admin') && others.length > 0;

  if (method === 'DELETE') {
    if (userId === me && room.type === 'private')
      return json({ error: 'You cannot leave your private chat room' }, 403);
    if (userId !== me) {
      if (room.type === 'direct') return json({ error: 'You can only remove yourself from a direct chat room' }, 403);
      if (!isAdmin) return json({ error: ADMIN_ONLY }, 403);
    }
    if (!target) return json({ error: 'Member not found in this chat room' }, 404);
    if (onlyAdmin && room.type === 'group') {
      return json(
        { error: 'The only admin cannot be removed while other members remain; promote another member to admin first' },
        409,
      );
    }
    if (userId === me) state.rooms.splice(state.rooms.indexOf(room), 1);
    else room.members = others;
    return noContent();
  }

  if (method === 'PATCH') {
    const refused = notAGroup(room);
    if (refused) return refused;
    if (!isAdmin) return json({ error: ADMIN_ONLY }, 403);
    const role = body?.role;
    if (role !== 'admin' && role !== 'member') return json({ error: '\'role\' must be "admin" or "member"' }, 400);
    if (!target) return json({ error: 'Member not found in this chat room' }, 404);
    if (role === 'member' && onlyAdmin) {
      return json(
        { error: 'The only admin cannot be demoted while other members remain; promote another member to admin first' },
        409,
      );
    }
    target.role = role as Role;
    return json({ member: memberOf(room, target) } satisfies MemberResponse);
  }
  return undefined;
}
