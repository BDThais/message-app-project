// @vitest-environment jsdom
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { john, NEW_PASSWORD, PASSWORD, stubApi, type FakeServer } from './helpers/fakeApi';
import { renderApp } from './helpers/renderApp';

// The settings page through the real router, guards and query client against the fake API: the
// profile, the password, and the deletion of the account.

beforeEach(() => {
  window.scrollTo = vi.fn(); // jsdom has none, and the router scrolls to the top on navigation
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function openSettings(prepare?: (server: FakeServer) => void) {
  const server = stubApi({ signedIn: true });
  prepare?.(server);
  const view = renderApp('/settings');
  return { server, user: userEvent.setup(), ...view };
}

const section = async (name: string) => within(await screen.findByRole('region', { name }));
const bodyOf = (server: FakeServer, request: string) => server.calls.find((call) => call.request === request)?.body;

describe('getting there', () => {
  it('is in the main navigation', async () => {
    const server = stubApi({ signedIn: true });
    const user = userEvent.setup();
    renderApp('/chat');

    await user.click(await screen.findByRole('link', { name: 'Settings' }));

    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeTruthy();
    expect(server.count('GET /api/account/me')).toBe(1);
  });

  it('sends a signed-out visitor to the login page', async () => {
    stubApi();
    const { router } = renderApp('/settings');

    await screen.findByRole('heading', { name: 'Sign in' });
    expect(router.state.location.pathname).toBe('/login');
  });
});

describe('the profile', () => {
  it('shows the name, the address and the number, and saves nothing until something is changed', async () => {
    openSettings();
    const profile = await section('Profile');

    expect((profile.getByLabelText('Name') as HTMLInputElement).value).toBe(john.name);
    expect(profile.getByText(john.email)).toBeTruthy();
    expect(profile.getByText(john.tel)).toBeTruthy();
    expect((profile.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('sends only the name that was changed, and the header shows it at once', async () => {
    const { server, user } = openSettings();
    const profile = await section('Profile');

    await user.clear(profile.getByLabelText('Name'));
    await user.type(profile.getByLabelText('Name'), ' JohnDoe2 '); // with the spaces an autocomplete leaves
    await user.click(profile.getByRole('button', { name: 'Save changes' }));

    expect(await profile.findByText('Saved.')).toBeTruthy();
    expect(bodyOf(server, 'PATCH /api/account/me')).toEqual({ name: 'JohnDoe2' });
    expect(within(screen.getByRole('banner')).getByText('JohnDoe2')).toBeTruthy();
    expect((profile.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement).disabled).toBe(true);
    expect(server.count('GET /api/account/me')).toBe(1); // the answer of the PATCH is the new user: no second request
  });

  it('sends only the avatar URL when that is what changed, and null when it is emptied', async () => {
    const { server, user } = openSettings();
    const profile = await section('Profile');

    await user.type(profile.getByLabelText('Avatar URL'), 'https://example.com/john.png');
    await user.click(profile.getByRole('button', { name: 'Save changes' }));
    await profile.findByText('Saved.');
    expect(bodyOf(server, 'PATCH /api/account/me')).toEqual({ avatar_url: 'https://example.com/john.png' });

    await user.clear(profile.getByLabelText('Avatar URL'));
    await user.click(profile.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(server.session?.avatarUrl).toBeNull());
    expect(server.calls.filter((call) => call.request === 'PATCH /api/account/me').map((call) => call.body)).toEqual([
      { avatar_url: 'https://example.com/john.png' },
      { avatar_url: null },
    ]);
  });

  it('shows the server\'s refusal, keeps what was typed, and does not say "Saved."', async () => {
    const { user, server } = openSettings();
    const profile = await section('Profile');

    await user.clear(profile.getByLabelText('Name'));
    await user.type(profile.getByLabelText('Name'), 'John Doe');
    await user.click(profile.getByRole('button', { name: 'Save changes' }));

    expect((await profile.findByRole('alert')).textContent).toBe('Name must contain only letters and numbers');
    expect((profile.getByLabelText('Name') as HTMLInputElement).value).toBe('John Doe');
    expect(profile.queryByText('Saved.')).toBeNull();
    expect(server.session?.name).toBe(john.name);
  });

  it('takes the "Saved." away as soon as something is changed again', async () => {
    const { user } = openSettings();
    const profile = await section('Profile');

    await user.type(profile.getByLabelText('Name'), '2');
    await user.click(profile.getByRole('button', { name: 'Save changes' }));
    await profile.findByText('Saved.');
    await user.type(profile.getByLabelText('Name'), '3');

    expect(profile.queryByText('Saved.')).toBeNull();
  });
});

describe('the password', () => {
  async function fill(user: ReturnType<typeof userEvent.setup>, current: string, next: string) {
    const password = await section('Password');
    await user.type(password.getByLabelText('Current password'), current);
    await user.type(password.getByLabelText('New password'), next);
    await user.click(password.getByRole('button', { name: 'Change password' }));
    return password;
  }

  it('changes it, says so, empties the fields, and keeps the person signed in', async () => {
    const { server, user, router } = openSettings();

    const password = await fill(user, PASSWORD, NEW_PASSWORD);

    expect(await password.findByText(/Password changed/)).toBeTruthy();
    expect(bodyOf(server, 'POST /api/account/password')).toEqual({
      current_password: PASSWORD,
      new_password: NEW_PASSWORD,
    });
    expect((password.getByLabelText('Current password') as HTMLInputElement).value).toBe('');
    expect((password.getByLabelText('New password') as HTMLInputElement).value).toBe('');
    expect(router.state.location.pathname).toBe('/settings');
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy();
  });

  it('says that the current password is wrong without ending the session', async () => {
    const { user, router, server } = openSettings();

    const password = await fill(user, 'not-it', NEW_PASSWORD);

    expect((await password.findByRole('alert')).textContent).toBe('Current password is incorrect');
    expect(password.queryByText(/Password changed/)).toBeNull();
    // The 401 made the app ask who is signed in; it was told "still John", and the person stayed.
    await waitFor(() => expect(server.count('GET /api/account/me')).toBe(2));
    expect(router.state.location.pathname).toBe('/settings');
    expect((password.getByLabelText('Current password') as HTMLInputElement).value).toBe('not-it');
  });

  it("shows the server's text for a new password that breaks its rules", async () => {
    const { user } = openSettings();

    const password = await fill(user, PASSWORD, 'weakpass1!');

    expect((await password.findByRole('alert')).textContent).toBe(
      'Password must contain at least one uppercase letter',
    );
  });
});

describe('deleting the account', () => {
  const askToDelete = async (user: ReturnType<typeof userEvent.setup>) => {
    const section_ = await section('Delete account');
    await user.click(section_.getByRole('button', { name: 'Delete my account…' }));
    return section_;
  };

  it('asks for the password first, and Cancel puts the button back and forgets what was typed', async () => {
    const { user, server } = openSettings();
    const deletion = await askToDelete(user);

    await user.type(deletion.getByLabelText('Your password'), 'half typed');
    await user.click(deletion.getByRole('button', { name: 'Cancel' }));

    expect(deletion.getByRole('button', { name: 'Delete my account…' })).toBeTruthy();
    await user.click(deletion.getByRole('button', { name: 'Delete my account…' }));
    expect((deletion.getByLabelText('Your password') as HTMLInputElement).value).toBe('');
    expect(server.count('DELETE /api/account/me')).toBe(0);
  });

  it('forgets a refusal, and the rooms with it, when the person cancels', async () => {
    const { user } = openSettings((fake) => {
      fake.addRoom({ id: 3, name: 'Project chat', type: 'group' });
      fake.deletionBlockedBy = [3];
    });
    const deletion = await askToDelete(user);
    await user.type(deletion.getByLabelText('Your password'), PASSWORD);
    await user.click(deletion.getByRole('button', { name: 'Delete my account' }));
    await deletion.findByRole('alert');

    await user.click(deletion.getByRole('button', { name: 'Cancel' }));
    await user.click(deletion.getByRole('button', { name: 'Delete my account…' }));

    expect(deletion.queryByRole('alert')).toBeNull();
    expect(deletion.queryByRole('list')).toBeNull();
  });

  it('deletes the account and goes to the sign-in page without a way back to this page', async () => {
    const { user, server, router } = openSettings();
    const deletion = await askToDelete(user);

    await user.type(deletion.getByLabelText('Your password'), PASSWORD);
    await user.click(deletion.getByRole('button', { name: 'Delete my account' }));

    await screen.findByRole('heading', { name: 'Sign in' });
    expect(bodyOf(server, 'DELETE /api/account/me')).toEqual({ password: PASSWORD });
    expect(router.state.location.href).toBe('/login');
    expect(server.accounts).toHaveLength(0);
  });

  it('says that the password is wrong and stays signed in', async () => {
    const { user, router, server } = openSettings();
    const deletion = await askToDelete(user);

    await user.type(deletion.getByLabelText('Your password'), 'not-it');
    await user.click(deletion.getByRole('button', { name: 'Delete my account' }));

    expect((await deletion.findByRole('alert')).textContent).toBe('Password is incorrect');
    expect(deletion.queryByRole('list')).toBeNull();
    await waitFor(() => expect(server.count('GET /api/account/me')).toBe(2));
    expect(router.state.location.pathname).toBe('/settings');
    expect(server.accounts).toHaveLength(1);
  });

  it('lists the rooms the person is the only admin of, by name, as links, and deletes nothing', async () => {
    const { user, server, router } = openSettings((fake) => {
      fake.addRoom({ id: 3, name: 'Project chat', type: 'group' });
      fake.deletionBlockedBy = [3, 8]; // 8 is a room the list does not have (yet)
    });
    const deletion = await askToDelete(user);

    await user.type(deletion.getByLabelText('Your password'), PASSWORD);
    await user.click(deletion.getByRole('button', { name: 'Delete my account' }));

    expect((await deletion.findByRole('alert')).textContent).toMatch(/only admin of a group room/);
    const rooms = deletion.getByRole('list', { name: 'Rooms to sort out first' });
    expect(
      within(rooms)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Project chat', 'Chat 8']);
    expect(server.accounts).toHaveLength(1);

    await user.click(within(rooms).getByRole('link', { name: 'Project chat' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/chat/3'));
    // The link opens the members panel, where the person can make someone else an admin or delete the room.
    expect(router.state.location.search).toEqual({ members: true });
    expect(await screen.findByRole('region', { name: 'Members' })).toBeTruthy();
  });
});

describe('ending the session on purpose', () => {
  it('does not leave the next session looking as if it were ending (Sign out works again after signing in)', async () => {
    stubApi({ signedIn: true });
    const user = userEvent.setup();
    renderApp('/chat');

    await user.click(await screen.findByRole('button', { name: 'Sign out' }));
    await user.type(await screen.findByLabelText('Email'), john.email);
    await user.type(screen.getByLabelText('Password'), PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    const signOut = (await screen.findByRole('button', { name: 'Sign out' })) as HTMLButtonElement;
    expect(signOut.disabled).toBe(false);
  });
});
