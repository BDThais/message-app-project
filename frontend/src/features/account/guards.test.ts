import { isRedirect } from '@tanstack/react-router';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { User } from './types';
import { redirectIfSignedIn, requireUser, safeRedirectPath } from './guards';
import { accountKeys } from './queries';

const user: User = {
  id: 1,
  name: 'JohnDoe',
  email: 'john@example.com',
  tel: '+1234567890',
  avatarUrl: null,
  emailVerified: false,
};

// GET /account/me answers 200 with { user } or { user: null }; the guards run against that.
function stubMe(me: User | null) {
  const fetchMock = vi.fn(
    async () => new Response(JSON.stringify({ user: me }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function thrownBy(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  return undefined;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('safeRedirectPath', () => {
  it.each(['/chat', '/chat/12', '/chat/12?tab=members#top'])('keeps the on-site path %s', (path) => {
    expect(safeRedirectPath(path)).toBe(path);
  });

  it.each([
    undefined,
    null,
    42,
    '',
    'chat',
    'https://evil.example/chat',
    '//evil.example',
    '/\\evil.example',
    '/chat\nSet-Cookie: x=1',
  ])('falls back to /chat for %j', (target) => {
    expect(safeRedirectPath(target)).toBe('/chat');
  });
});

describe('requireUser', () => {
  it('returns the user when somebody is signed in', async () => {
    stubMe(user);

    await expect(requireUser(new QueryClient(), '/chat')).resolves.toEqual(user);
  });

  it('redirects to /login, remembering the page, when nobody is signed in', async () => {
    stubMe(null);

    const thrown = await thrownBy(requireUser(new QueryClient(), '/chat/12?tab=members'));

    expect(isRedirect(thrown)).toBe(true);
    expect(thrown).toMatchObject({ options: { to: '/login', search: { redirect: '/chat/12?tab=members' } } });
  });

  it('asks the server once, then answers from the cache', async () => {
    const fetchMock = stubMe(user);
    const queryClient = new QueryClient();

    await requireUser(queryClient, '/chat');
    await requireUser(queryClient, '/chat/2');

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps answering from the cache after it was invalidated: the layout refetches it, a navigation never waits for the server', async () => {
    const fetchMock = stubMe(user);
    const queryClient = new QueryClient();
    await requireUser(queryClient, '/chat');

    await queryClient.invalidateQueries({ queryKey: accountKeys.me() }); // as a 401 does (see main.tsx)
    await requireUser(queryClient, '/chat/2');

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('asks the server again once the cached answer was dropped (recheckSession)', async () => {
    const fetchMock = stubMe(user);
    const queryClient = new QueryClient();
    await requireUser(queryClient, '/chat');

    await queryClient.resetQueries({ queryKey: accountKeys.me(), exact: true });
    await requireUser(queryClient, '/chat/2');

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('redirectIfSignedIn', () => {
  it('sends a signed-in user to /chat', async () => {
    stubMe(user);

    const thrown = await thrownBy(redirectIfSignedIn(new QueryClient()));

    expect(isRedirect(thrown)).toBe(true);
    expect(thrown).toMatchObject({ options: { to: '/chat' } });
  });

  it('lets a signed-out visitor through', async () => {
    stubMe(null);

    await expect(redirectIfSignedIn(new QueryClient())).resolves.toBeUndefined();
  });

  it('also answers from the cache after it was invalidated', async () => {
    const fetchMock = stubMe(null);
    const queryClient = new QueryClient();
    await redirectIfSignedIn(queryClient);

    await queryClient.invalidateQueries({ queryKey: accountKeys.me() });
    await redirectIfSignedIn(queryClient);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
