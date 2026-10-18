// @vitest-environment jsdom
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { john, NEW_PASSWORD, PASSWORD, stubApi } from './helpers/fakeApi';
import { renderApp } from './helpers/renderApp';

// The account screens other than the thin sign-in loop (that one is in app.test.tsx): signup, the
// forgot/reset password flow, the pages behind the mailed links, and the verify-your-email banner.
// They run through the real router, guards and query client against the fake API.

type User = ReturnType<typeof userEvent.setup>;

beforeEach(() => {
  window.scrollTo = vi.fn(); // jsdom has none, and the router scrolls to the top on navigation
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function fillSignup(
  user: User,
  { name = 'JaneDoe', email = 'jane@example.com', tel = '+19876543210', password = PASSWORD } = {},
) {
  await user.type(await screen.findByLabelText('Name'), name);
  await user.type(screen.getByLabelText('Email'), email);
  await user.type(screen.getByLabelText('Phone number'), tel);
  await user.type(screen.getByLabelText('Password'), password);
}

describe('signup', () => {
  it('creates the account, asks the person to check their email, and does not sign them in', async () => {
    const server = stubApi();
    const user = userEvent.setup();
    const { router } = renderApp('/signup');

    await fillSignup(user, { name: 'JaneDoe ' }); // a trailing space, as autocomplete leaves one
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeTruthy();
    expect(screen.getByText('jane@example.com')).toBeTruthy();
    expect(server.calls.find((call) => call.request === 'POST /api/account/signup')?.body).toEqual({
      name: 'JaneDoe',
      email: 'jane@example.com',
      tel: '+19876543210',
      password: PASSWORD,
    });
    expect(server.session).toBeNull();

    // The way on is the login page, and the new account can sign in.
    await user.click(screen.getByRole('link', { name: 'Sign in' }));
    await user.type(await screen.findByLabelText('Email'), 'jane@example.com');
    await user.type(screen.getByLabelText('Password'), PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/chat'));
    expect(server.session?.name).toBe('JaneDoe');
  });

  it("shows the server's text when it refuses, and keeps what was typed", async () => {
    stubApi();
    const user = userEvent.setup();
    const { router } = renderApp('/signup');

    await fillSignup(user, { email: john.email }); // John's address is taken
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect((await screen.findByRole('alert')).textContent).toBe('Email already exists');
    expect(router.state.location.pathname).toBe('/signup');
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('JaneDoe');
    expect((screen.getByLabelText('Email') as HTMLInputElement).value).toBe(john.email);
    expect((screen.getByRole('button', { name: 'Create account' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('sends one request however often the button is clicked: the limiters count every request', async () => {
    const server = stubApi();
    const user = userEvent.setup();
    renderApp('/signup');
    await fillSignup(user);

    let release!: () => void;
    server.gate = new Promise<void>((resolve) => (release = resolve)); // the request stays open
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    const button = await screen.findByRole('button', { name: 'Creating account…' });
    await user.click(button);
    await user.click(button);

    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(server.count('POST /api/account/signup')).toBe(1);
    release();
    expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeTruthy();
  });

  it('keeps a signed-in user off the signup page', async () => {
    stubApi({ signedIn: true });
    const { router } = renderApp('/signup');

    expect(await screen.findByRole('heading', { name: 'Chats' })).toBeTruthy();
    expect(router.state.location.pathname).toBe('/chat');
  });
});

describe('forgot password', () => {
  it('words the answer like the server does, and never promises that a mail was sent', async () => {
    const server = stubApi();
    const user = userEvent.setup();
    renderApp('/forgot-password');

    await user.type(await screen.findByLabelText('Email'), 'nobody@example.com'); // not registered: the screen must not tell
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));

    expect(await screen.findByText(/If an account exists for/)).toBeTruthy();
    expect(screen.getByText(/a reset link is on its way/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/we sent|has been sent|was sent/i);
    expect(server.calls.find((call) => call.request === 'POST /api/account/password/reset-request')?.body).toEqual({
      email: 'nobody@example.com',
    });
  });
});

describe('the verification link', () => {
  it('posts the token once (even in StrictMode), takes it out of the address bar, and says so', async () => {
    const server = stubApi();
    server.verificationTokens.set('good-token', john.id);
    const { router } = renderApp('/verify-email#token=good-token', { strict: true });

    expect(await screen.findByText('Your email address is verified.')).toBeTruthy();
    expect(server.count('POST /api/account/email/verify')).toBe(1);
    expect(server.calls.find((call) => call.request === 'POST /api/account/email/verify')?.body).toEqual({
      token: 'good-token',
    });
    expect(router.state.location.hash).toBe('');
    expect(router.state.location.href).not.toContain('good-token');
    expect(server.accounts[0]?.user.emailVerified).toBe(true);
  });

  it("shows the server's text for a link that is used up or expired", async () => {
    stubApi();
    renderApp('/verify-email#token=stale-token');

    expect((await screen.findByRole('alert')).textContent).toBe('This verification link is invalid or has expired');
  });

  it('works for a signed-in user, whose banner is gone when they go on', async () => {
    const server = stubApi({ signedIn: true });
    server.verificationTokens.set('good-token', john.id);
    const user = userEvent.setup();
    const { router } = renderApp('/chat');
    expect(await screen.findByRole('button', { name: 'Resend verification email' })).toBeTruthy(); // `me` is cached: unverified

    await router.navigate({ to: '/verify-email', hash: 'token=good-token' });
    expect(await screen.findByText('Your email address is verified.')).toBeTruthy();
    await user.click(screen.getByRole('link', { name: 'Continue' }));

    // The cached answer was dropped, so the server was asked again and the banner is gone.
    expect(await screen.findByRole('heading', { name: 'Chats' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Resend verification email' })).toBeNull();
  });
});

describe('the reset link', () => {
  it('sets the new password with the token, takes the token out of the address bar, and leads to sign in', async () => {
    const server = stubApi();
    server.resetTokens.set('reset-token', john.id);
    const user = userEvent.setup();
    const { router } = renderApp('/reset-password#token=reset-token');

    await user.type(await screen.findByLabelText('New password'), NEW_PASSWORD);
    expect(router.state.location.href).not.toContain('reset-token');
    await user.click(screen.getByRole('button', { name: 'Change password' }));

    expect(await screen.findByRole('heading', { name: 'Password changed' })).toBeTruthy();
    expect(server.calls.find((call) => call.request === 'POST /api/account/password/reset')?.body).toEqual({
      token: 'reset-token',
      new_password: NEW_PASSWORD,
    });

    // The reset does not sign anyone in; the new password works at the login page.
    expect(server.session).toBeNull();
    await user.click(screen.getByRole('link', { name: 'Sign in' }));
    await user.type(await screen.findByLabelText('Email'), john.email);
    await user.type(screen.getByLabelText('Password'), NEW_PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/chat'));
  });

  it('lets a refused password be corrected and sent again, although the token is no longer in the URL', async () => {
    const server = stubApi();
    server.resetTokens.set('reset-token', john.id);
    const user = userEvent.setup();
    renderApp('/reset-password#token=reset-token');

    await user.type(await screen.findByLabelText('New password'), 'weak!pass1');
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Password must contain at least one uppercase letter');
    expect(server.resetTokens.has('reset-token')).toBe(true); // the refusal did not use up the link

    await user.clear(screen.getByLabelText('New password'));
    await user.type(screen.getByLabelText('New password'), NEW_PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Change password' }));

    expect(await screen.findByRole('heading', { name: 'Password changed' })).toBeTruthy();
  });

  it('notices that the session of a signed-in person ended with the reset', async () => {
    const server = stubApi({ signedIn: true });
    server.resetTokens.set('reset-token', john.id);
    const user = userEvent.setup();
    const { router } = renderApp('/chat');
    await screen.findByRole('heading', { name: 'Chats' }); // `me` is cached: John is signed in

    await router.navigate({ to: '/reset-password', hash: 'token=reset-token' });
    await user.type(await screen.findByLabelText('New password'), NEW_PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    await screen.findByRole('heading', { name: 'Password changed' });
    await user.click(screen.getByRole('link', { name: 'Sign in' }));

    // Not bounced on to /chat by a stale cache: the server was asked again and said nobody is signed in.
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeTruthy();
    expect(router.state.location.pathname).toBe('/login');
  });
});

describe.each(['/verify-email', '/reset-password'])('%s without a token', (path) => {
  it('says the link is incomplete and sends nothing', async () => {
    const server = stubApi();
    renderApp(path);

    expect(await screen.findByText(/This link is incomplete/)).toBeTruthy();
    expect(server.requests.filter((request) => request.startsWith('POST'))).toEqual([]);
  });
});

describe('the verify-your-email banner', () => {
  it('shows for an unverified user, and its button asks for a new mail', async () => {
    const server = stubApi({ signedIn: true });
    const user = userEvent.setup();
    renderApp('/chat');

    expect(await screen.findByText(john.email, { selector: 'strong' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Resend verification email' }));

    expect(await screen.findByText(/Verification email sent/)).toBeTruthy();
    expect(server.count('POST /api/account/email/verification')).toBe(1);
  });

  it('does not show for a verified user', async () => {
    const server = stubApi({ signedIn: true });
    server.accounts[0]!.user.emailVerified = true;
    renderApp('/chat');

    await screen.findByRole('heading', { name: 'Chats' });
    expect(screen.queryByRole('button', { name: 'Resend verification email' })).toBeNull();
  });

  it("shows the server's text when it is asked too soon", async () => {
    const server = stubApi({ signedIn: true });
    server.resendLimited = true;
    const user = userEvent.setup();
    renderApp('/chat');

    await user.click(await screen.findByRole('button', { name: 'Resend verification email' }));

    expect((await screen.findByRole('alert')).textContent).toBe('Please wait a minute before asking for another email');
  });

  it('goes away when the server says the address is already verified (done in another tab)', async () => {
    const server = stubApi({ signedIn: true });
    const user = userEvent.setup();
    renderApp('/chat');
    const resend = await screen.findByRole('button', { name: 'Resend verification email' });
    server.accounts[0]!.user.emailVerified = true; // verified elsewhere; this tab's cache does not know

    await user.click(resend);

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Resend verification email' })).toBeNull());
  });
});
