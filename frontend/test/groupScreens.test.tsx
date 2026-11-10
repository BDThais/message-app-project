// @vitest-environment jsdom
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Role } from '@contract/types';
import { chatKeys } from '@/features/chats/keys';
import { Route as chatRoute } from '@/routes/_app/chat.$chatId';
import type { Member } from '@/features/chats/types';
import { bea, carl, dana, john, stubApi, type FakeServer } from './helpers/fakeApi';
import { renderApp } from './helpers/renderApp';

// Group rooms through the real router, guards and query client against the fake API: making one, and the
// members panel (roles, adding, removing, renaming, leaving, deleting).

beforeEach(() => {
  window.scrollTo = vi.fn(); // jsdom has none, and the router scrolls to the top on navigation
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

type User = ReturnType<typeof userEvent.setup>;
const bodyOf = (server: FakeServer, request: string) => server.calls.find((call) => call.request === request)?.body;
const callsOf = (server: FakeServer, request: string) => server.calls.filter((call) => call.request === request);
const roomList = () => within(screen.getByRole('navigation', { name: 'Chats' }));

/** John, Bea and Carl in room 3, "Project chat": John is its admin, or its plain member (and Bea the admin). */
function openGroup({
  me = 'admin',
  friends = [bea, carl, dana],
  path = '/chat/3?members=true',
}: { me?: Role; friends?: Array<{ id: number }>; path?: string } = {}) {
  const server = stubApi({ signedIn: true });
  server.friendIds = friends.map(({ id }) => id);
  server.addRoom({
    id: 3,
    type: 'group',
    name: 'Project chat',
    members: [
      { userId: john.id, role: me },
      { userId: bea.id, role: me === 'admin' ? 'member' : 'admin' },
      { userId: carl.id, role: 'member' },
    ],
  });
  const view = renderApp(path);
  return { server, user: userEvent.setup(), ...view };
}

const section = async (name: string) => within(await screen.findByRole('region', { name }));
const nameOf = (item: HTMLElement) => item.querySelector('.truncate')?.textContent ?? '';
/** The rows of the Members card, as "Name" or "Name (admin)", with "(you)" left out. */
async function memberRows() {
  const members = await section('Members');
  await members.findAllByRole('listitem');
  return members.getAllByRole('listitem').map((item) => {
    const name = nameOf(item).replace(' (you)', '');
    return within(item).queryByText('Admin') ? `${name} (admin)` : name;
  });
}
async function rowOf(name: string) {
  const members = await section('Members');
  const item = (await members.findAllByRole('listitem')).find((each) => nameOf(each).startsWith(name));
  if (!item) throw new Error(`no member row for ${name}`);
  return within(item);
}
async function chooseFor(user: User, name: string, action: string) {
  await user.click((await rowOf(name)).getByRole('button', { name: `Actions for ${name}` }));
  await user.click(screen.getByRole('menuitem', { name: action }));
}

describe('making a group', () => {
  it('is started from the room list, and the list gives way to the form on a phone', async () => {
    const server = stubApi({ signedIn: true });
    const user = userEvent.setup();
    renderApp('/chat');

    await user.click(await screen.findByRole('link', { name: 'New group' }));

    expect(await screen.findByRole('heading', { name: 'New group' })).toBeTruthy();
    expect(roomList().getByRole('link', { name: 'New group' })).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Chats' }).className).toContain('hidden md:flex');
    expect(server.count('GET /api/friend')).toBe(1);
  });

  it('makes a group of the friends that were ticked, with the name, opens it and lists it', async () => {
    const server = stubApi({ signedIn: true });
    server.friendIds = [bea.id, carl.id, dana.id];
    const user = userEvent.setup();
    const { router } = renderApp('/chat/new');

    await user.type(await screen.findByLabelText('Name'), '  Weekend  ');
    await user.click(await screen.findByRole('checkbox', { name: 'Bea' }));
    await user.click(screen.getByRole('checkbox', { name: 'Dana' }));
    await user.click(screen.getByRole('button', { name: 'Create group' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/chat/1'));
    expect(bodyOf(server, 'POST /api/chat')).toEqual({ type: 'group', member_ids: [bea.id, dana.id], name: 'Weekend' });
    expect((await screen.findByRole('heading', { level: 1, name: 'Weekend' })).textContent).toBe('Weekend');
    expect(roomList().getByRole('link', { name: /Weekend/ })).toBeTruthy();
  });

  it('keeps the members the server answered with, so the panel has them before it asks again', async () => {
    const server = stubApi({ signedIn: true });
    server.friendIds = [bea.id, carl.id];
    const user = userEvent.setup();
    const { router, queryClient } = renderApp('/chat/new');

    await user.click(await screen.findByRole('checkbox', { name: 'Carl' }));
    await user.click(screen.getByRole('button', { name: 'Create group' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/chat/1'));

    const cached = queryClient.getQueryData<Member[]>(chatKeys.members(1));
    expect(cached?.map(({ member, role }) => `${member.name}:${role}`)).toEqual(['JohnDoe:admin', 'Carl:member']);
    expect(server.count('GET /api/chat/1/member')).toBe(0);
  });

  it('sends no name and no avatar when none was typed, and the group is called "Group chat"', async () => {
    const server = stubApi({ signedIn: true });
    server.friendIds = [bea.id];
    const user = userEvent.setup();
    renderApp('/chat/new');

    await user.click(await screen.findByRole('checkbox', { name: 'Bea' }));
    await user.click(screen.getByRole('button', { name: 'Create group' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Group chat' })).toBeTruthy();
    expect(bodyOf(server, 'POST /api/chat')).toEqual({ type: 'group', member_ids: [bea.id] });
  });

  it('leaves out a friend whose tick was taken away again', async () => {
    const server = stubApi({ signedIn: true });
    server.friendIds = [bea.id, carl.id];
    const user = userEvent.setup();
    renderApp('/chat/new');

    await user.click(await screen.findByRole('checkbox', { name: 'Bea' }));
    await user.click(screen.getByRole('checkbox', { name: 'Carl' }));
    await user.click(screen.getByRole('checkbox', { name: 'Bea' }));
    await user.click(screen.getByRole('button', { name: 'Create group' }));

    await screen.findByRole('heading', { level: 1, name: 'Group chat' });
    expect(bodyOf(server, 'POST /api/chat')).toEqual({ type: 'group', member_ids: [carl.id] });
  });

  it('sends the avatar URL, trimmed', async () => {
    const server = stubApi({ signedIn: true });
    const user = userEvent.setup();
    renderApp('/chat/new');

    await user.type(await screen.findByLabelText('Avatar URL'), ' https://example.com/g.png ');
    await user.click(screen.getByRole('button', { name: 'Create group' }));

    await screen.findByRole('heading', { level: 1, name: 'Group chat' });
    expect(bodyOf(server, 'POST /api/chat')).toEqual({
      type: 'group',
      member_ids: [],
      avatar_url: 'https://example.com/g.png',
    });
  });

  it('can be made with nobody else in it, and says so when there are no friends', async () => {
    const server = stubApi({ signedIn: true });
    const user = userEvent.setup();
    renderApp('/chat/new');

    expect(await screen.findByText(/You have no friends to add yet/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Create group' }));

    await screen.findByRole('heading', { level: 1, name: 'Group chat' });
    expect(bodyOf(server, 'POST /api/chat')).toEqual({ type: 'group', member_ids: [] });
  });

  it("shows the server's refusal, keeps the form as it was, and makes no room", async () => {
    const server = stubApi({ signedIn: true });
    server.friendIds = [bea.id, carl.id];
    const user = userEvent.setup();
    const { router } = renderApp('/chat/new');
    await user.click(await screen.findByRole('checkbox', { name: 'Carl' }));
    server.friendIds = [bea.id]; // Carl stopped being a friend while the page was open

    await user.click(screen.getByRole('button', { name: 'Create group' }));

    expect((await screen.findByRole('alert')).textContent).toBe('Only your friends can be added to a chat room');
    expect((screen.getByRole('checkbox', { name: 'Carl' }) as HTMLInputElement).checked).toBe(true);
    expect(router.state.location.pathname).toBe('/chat/new');
    expect(server.rooms).toHaveLength(0);
  });

  it('shows the 400 text for a name that is too long', async () => {
    const { user } = Object.assign(openGroup(), {});
    await user.click(await screen.findByRole('link', { name: 'Back to messages' }));
    await user.click(screen.getByRole('link', { name: 'New group' }));

    await user.type(await screen.findByLabelText('Name'), 'x'.repeat(101));
    await user.click(screen.getByRole('button', { name: 'Create group' }));

    expect((await screen.findByRole('alert')).textContent).toBe('name must be 100 characters or fewer');
  });
});

describe('the Members button', () => {
  it('is in the header of a group room only, and opens and closes the panel through the address', async () => {
    const { user, router } = openGroup({ path: '/chat/3' });

    await user.click(await screen.findByRole('link', { name: 'Members' }));

    expect(await screen.findByRole('region', { name: 'Members' })).toBeTruthy();
    expect(router.state.location.search).toEqual({ members: true });
    expect(screen.queryByRole('log', { name: 'Messages' })).toBeNull(); // hidden, still there behind the panel

    await user.click(screen.getByRole('link', { name: 'Back to messages' }));
    expect(await screen.findByRole('log', { name: 'Messages' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Members' })).toBeNull();
    expect(router.state.location.search).toEqual({});
  });

  it('takes only `true` for `members` as a reason to open the panel, whatever else the address holds', () => {
    const validate = chatRoute.options.validateSearch as (search: Record<string, unknown>) => unknown;

    expect(validate({ members: true })).toEqual({ members: true });
    expect(validate({ members: 'true' })).toEqual({});
    expect(validate({ members: false, other: 1 })).toEqual({});
    expect(validate({})).toEqual({});
  });

  it('is not in a direct room or in the private room', async () => {
    const server = stubApi({ signedIn: true });
    server.addRoom({ id: 1, type: 'direct', name: 'Bea', memberId: bea.id });
    server.addRoom({ id: 2, type: 'private', name: null });
    const user = userEvent.setup();
    renderApp('/chat/1');
    await screen.findByRole('heading', { level: 1, name: 'Bea' });
    expect(screen.queryByRole('link', { name: 'Members' })).toBeNull();

    await user.click(roomList().getByRole('link', { name: /My Documents/ }));
    await screen.findByRole('heading', { level: 1, name: 'My Documents' });
    expect(screen.queryByRole('link', { name: 'Members' })).toBeNull();
  });

  it('opens straight from a link with ?members=true and keeps the half-written message behind the panel', async () => {
    const { user } = openGroup({ path: '/chat/3' });
    await user.type(await screen.findByRole('textbox', { name: 'Message' }), 'half a thought');

    await user.click(screen.getByRole('link', { name: 'Members' }));
    await screen.findByRole('region', { name: 'Members' });
    await user.click(screen.getByRole('link', { name: 'Back to messages' }));

    expect((await screen.findByRole('textbox', { name: 'Message' })) as HTMLTextAreaElement).toHaveProperty(
      'value',
      'half a thought',
    );
  });
});

describe('the members', () => {
  it('lists them, admins first, with the person marked as "you"', async () => {
    openGroup();

    expect(await memberRows()).toEqual(['JohnDoe (admin)', 'Bea', 'Carl']);
    expect((await section('Members')).getByText('(you)')).toBeTruthy();
  });

  it('gives an admin the group form, a menu on every row but their own, adding, leaving and deleting', async () => {
    openGroup();

    await screen.findByRole('region', { name: 'Group' });
    expect(await screen.findByRole('region', { name: 'Add people' })).toBeTruthy();
    const members = await section('Members');
    await members.findAllByRole('listitem');
    expect(members.queryByRole('button', { name: 'Actions for JohnDoe' })).toBeNull();
    expect(members.getByRole('button', { name: 'Actions for Bea' })).toBeTruthy();
    expect(members.getByRole('button', { name: 'Actions for Carl' })).toBeTruthy();
    const leave = await section('Leave or delete');
    expect(leave.getByRole('button', { name: 'Leave group…' })).toBeTruthy();
    expect(leave.getByRole('button', { name: 'Delete group…' })).toBeTruthy();
  });

  it('gives a plain member the list and the way out, and nothing the server would refuse', async () => {
    openGroup({ me: 'member' });

    expect(await memberRows()).toEqual(['Bea (admin)', 'Carl', 'JohnDoe']);
    expect(screen.queryByRole('region', { name: 'Group' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Add people' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Actions for/ })).toBeNull();
    const leave = await section('Leave or delete');
    expect(leave.getByRole('button', { name: 'Leave group…' })).toBeTruthy();
    expect(leave.queryByRole('button', { name: 'Delete group…' })).toBeNull();
  });

  it('makes a member an admin and an admin a member again, and the list is sorted at once', async () => {
    const { user, server } = openGroup();
    await memberRows();

    await chooseFor(user, 'Carl', 'Make admin');
    await waitFor(async () => expect(await memberRows()).toEqual(['Carl (admin)', 'JohnDoe (admin)', 'Bea']));
    expect(bodyOf(server, `PATCH /api/chat/3/member/${carl.id}`)).toEqual({ role: 'admin' });

    await chooseFor(user, 'Carl', 'Make member');
    await waitFor(async () => expect(await memberRows()).toEqual(['JohnDoe (admin)', 'Bea', 'Carl']));
    expect(bodyOf(server, `PATCH /api/chat/3/member/${carl.id}`)).toEqual({ role: 'admin' });
    expect(callsOf(server, `PATCH /api/chat/3/member/${carl.id}`).map((call) => call.body)).toEqual([
      { role: 'admin' },
      { role: 'member' },
    ]);
  });

  it('removes a member without asking for the list again', async () => {
    const { user, server } = openGroup();
    await memberRows();

    await chooseFor(user, 'Carl', 'Remove from group');

    await waitFor(async () => expect(await memberRows()).toEqual(['JohnDoe (admin)', 'Bea']));
    expect(server.count(`DELETE /api/chat/3/member/${carl.id}`)).toBe(1);
    expect(server.count('GET /api/chat/3/member')).toBe(1);
  });

  it('says why when the member is already gone, and shows the list as it is now', async () => {
    const { user, server } = openGroup();
    await memberRows();
    server.rooms[0]!.members = server.rooms[0]!.members!.filter(({ userId }) => userId !== carl.id); // another admin removed Carl

    await chooseFor(user, 'Carl', 'Remove from group');

    expect((await (await section('Members')).findByRole('alert')).textContent).toBe(
      'Member not found in this chat room',
    );
    await waitFor(async () => expect(await memberRows()).toEqual(['JohnDoe (admin)', 'Bea']));
  });

  it('shows the refusal of one action until the next one is made, even when the next one is another kind', async () => {
    const { user, server } = openGroup();
    await memberRows();
    server.rooms[0]!.members = server.rooms[0]!.members!.filter(({ userId }) => userId !== carl.id);
    await chooseFor(user, 'Carl', 'Remove from group'); // a removal that is refused...
    const members = await section('Members');
    await members.findByRole('alert');

    await chooseFor(user, 'Bea', 'Make admin'); // ...and then a role change that works

    await waitFor(() => expect(members.queryByRole('alert')).toBeNull());
    expect(await memberRows()).toEqual(['Bea (admin)', 'JohnDoe (admin)']);
  });
});

describe("the group's name and avatar", () => {
  it('sends only the name that was changed, and the room list and the header show it at once', async () => {
    const { user, server } = openGroup();
    const group = await section('Group');

    await user.clear(group.getByLabelText('Group name'));
    await user.type(group.getByLabelText('Group name'), ' Renamed ');
    await user.click(group.getByRole('button', { name: 'Save changes' }));

    expect(await group.findByText('Saved.')).toBeTruthy();
    expect(bodyOf(server, 'PATCH /api/chat/3')).toEqual({ name: 'Renamed' });
    expect(roomList().getByRole('link', { name: /Renamed/ })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Renamed' })).toBeTruthy();
    expect((group.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('takes "Saved." away as soon as something is changed again', async () => {
    const { user } = openGroup();
    const group = await section('Group');

    await user.type(group.getByLabelText('Group name'), '2');
    await user.click(group.getByRole('button', { name: 'Save changes' }));
    await group.findByText('Saved.');
    await user.type(group.getByLabelText('Group name'), '3');

    expect(group.queryByText('Saved.')).toBeNull();
  });

  it('sends the avatar URL alone, and null when it is emptied', async () => {
    const { user, server } = openGroup();
    const group = await section('Group');

    await user.type(group.getByLabelText('Avatar URL'), 'https://example.com/g.png');
    await user.click(group.getByRole('button', { name: 'Save changes' }));
    await group.findByText('Saved.');
    await user.clear(group.getByLabelText('Avatar URL'));
    await user.click(group.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(server.rooms[0]!.avatarUrl).toBeNull());
    expect(callsOf(server, 'PATCH /api/chat/3').map((call) => call.body)).toEqual([
      { avatar_url: 'https://example.com/g.png' },
      { avatar_url: null },
    ]);
  });

  it("shows the server's refusal for a name that is empty or too long, and keeps what was typed", async () => {
    const { user } = openGroup();
    const group = await section('Group');

    await user.clear(group.getByLabelText('Group name'));
    await user.click(group.getByRole('button', { name: 'Save changes' }));
    expect((await group.findByRole('alert')).textContent).toBe("'name' must be a non-empty string");

    await user.type(group.getByLabelText('Group name'), 'x'.repeat(101));
    await user.click(group.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(group.getByRole('alert').textContent).toBe("'name' must be 100 characters or fewer"));
    expect((group.getByLabelText('Group name') as HTMLInputElement).value).toHaveLength(101);
    expect(group.queryByText('Saved.')).toBeNull();
  });
});

describe('adding people', () => {
  it('offers the friends who are not in the group, adds the ones ticked, and the list grows', async () => {
    const { user, server } = openGroup();
    const add = await section('Add people');

    // Bea and Carl are in the group already: Dana is the only friend left to offer.
    expect(add.getAllByRole('checkbox')).toHaveLength(1);
    await user.click(add.getByRole('checkbox', { name: 'Dana' }));
    await user.click(add.getByRole('button', { name: 'Add to group' }));

    await waitFor(async () => expect(await memberRows()).toEqual(['JohnDoe (admin)', 'Bea', 'Carl', 'Dana']));
    expect(bodyOf(server, 'POST /api/chat/3/member')).toEqual({ member_ids: [dana.id] });
    expect(await add.findByText('All your friends are in this group.')).toBeTruthy();
  });

  it('forgets who was ticked once they are added, so the button waits for the next tick', async () => {
    const { user } = openGroup();
    await memberRows();
    await chooseFor(user, 'Carl', 'Remove from group'); // Carl and Dana are both friends to add now
    const add = await section('Add people');
    await waitFor(() => expect(add.getAllByRole('checkbox')).toHaveLength(2));

    await user.click(add.getByRole('checkbox', { name: 'Carl' }));
    await user.click(add.getByRole('button', { name: 'Add to group' }));

    await waitFor(() => expect(add.getAllByRole('checkbox')).toHaveLength(1));
    expect((add.getByRole('checkbox', { name: 'Dana' }) as HTMLInputElement).checked).toBe(false);
    expect((add.getByRole('button', { name: 'Add to group' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('cannot be pressed until somebody is ticked', async () => {
    openGroup();
    const add = await section('Add people');

    expect((add.getByRole('button', { name: 'Add to group' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows the server's refusal when the friend is not one any more, and adds nobody", async () => {
    const { user, server } = openGroup();
    const add = await section('Add people');
    await user.click(add.getByRole('checkbox', { name: 'Dana' }));
    server.friendIds = [bea.id, carl.id];

    await user.click(add.getByRole('button', { name: 'Add to group' }));

    expect((await add.findByRole('alert')).textContent).toBe('Only your friends can be added to a chat room');
    expect(await memberRows()).toEqual(['JohnDoe (admin)', 'Bea', 'Carl']);
  });

  it('says there is nobody to add when the person has no friends', async () => {
    openGroup({ friends: [] });

    expect(await (await section('Add people')).findByText('You have no friends to add yet.')).toBeTruthy();
  });
});

describe('leaving and deleting', () => {
  it('asks first, and Cancel changes nothing', async () => {
    const { user, server } = openGroup();
    const leave = await section('Leave or delete');

    await user.click(leave.getByRole('button', { name: 'Leave group…' }));
    expect(leave.getByRole('group', { name: 'Confirm leaving' })).toBeTruthy();
    await user.click(leave.getByRole('button', { name: 'Cancel' }));

    expect(leave.getByRole('button', { name: 'Leave group…' })).toBeTruthy();
    expect(server.count(`DELETE /api/chat/3/member/${john.id}`)).toBe(0);
  });

  it('leaves a group the person is a plain member of, and the room is gone from the list', async () => {
    const { user, server, router } = openGroup({ me: 'member' });
    const leave = await section('Leave or delete');

    await user.click(leave.getByRole('button', { name: 'Leave group…' }));
    await user.click(
      within(leave.getByRole('group', { name: 'Confirm leaving' })).getByRole('button', { name: 'Leave group' }),
    );

    await waitFor(() => expect(router.state.location.pathname).toBe('/chat'));
    expect(server.count(`DELETE /api/chat/3/member/${john.id}`)).toBe(1);
    expect(roomList().queryByRole('link', { name: /Project chat/ })).toBeNull();
    expect(await screen.findByText('You have no chats yet.')).toBeTruthy();
  });

  it('says that the only admin cannot leave while others remain, and stays in the room', async () => {
    const { user, router } = openGroup();
    const leave = await section('Leave or delete');

    await user.click(leave.getByRole('button', { name: 'Leave group…' }));
    await user.click(
      within(leave.getByRole('group', { name: 'Confirm leaving' })).getByRole('button', { name: 'Leave group' }),
    );

    expect((await leave.findByRole('alert')).textContent).toBe(
      'The only admin cannot be removed while other members remain; promote another member to admin first',
    );
    expect(router.state.location.pathname).toBe('/chat/3');
    expect(roomList().getByRole('link', { name: /Project chat/ })).toBeTruthy();
  });

  it('lets the only admin leave once someone else is an admin', async () => {
    const { user, router } = openGroup();
    await memberRows();
    await chooseFor(user, 'Bea', 'Make admin');
    await waitFor(async () => expect(await memberRows()).toEqual(['Bea (admin)', 'JohnDoe (admin)', 'Carl']));
    const leave = await section('Leave or delete');

    await user.click(leave.getByRole('button', { name: 'Leave group…' }));
    await user.click(
      within(leave.getByRole('group', { name: 'Confirm leaving' })).getByRole('button', { name: 'Leave group' }),
    );

    await waitFor(() => expect(router.state.location.pathname).toBe('/chat'));
  });

  it('deletes the group for an admin after asking, and the room is gone from the list', async () => {
    const { user, server, router } = openGroup();
    const leave = await section('Leave or delete');

    await user.click(leave.getByRole('button', { name: 'Delete group…' }));
    expect(leave.getByText(/Delete this group and all its messages for everyone/)).toBeTruthy();
    await user.click(
      within(leave.getByRole('group', { name: 'Confirm deleting' })).getByRole('button', { name: 'Delete group' }),
    );

    await waitFor(() => expect(router.state.location.pathname).toBe('/chat'));
    expect(server.count('DELETE /api/chat/3')).toBe(1);
    expect(server.rooms).toHaveLength(0);
    expect(await screen.findByText('You have no chats yet.')).toBeTruthy();
  });

  it('forgets a refusal when the person cancels', async () => {
    const { user } = openGroup();
    const leave = await section('Leave or delete');
    await user.click(leave.getByRole('button', { name: 'Leave group…' }));
    await user.click(
      within(leave.getByRole('group', { name: 'Confirm leaving' })).getByRole('button', { name: 'Leave group' }),
    );
    await leave.findByRole('alert');

    await user.click(leave.getByRole('button', { name: 'Cancel' }));

    expect(leave.queryByRole('alert')).toBeNull();
  });
});
