import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from './http';

// The real `api` runs against a stubbed fetch, so the tests see the request it really builds.

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function stubFetch(respond: () => Response | Promise<Response>) {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => respond());
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function lastRequest(fetchMock: ReturnType<typeof stubFetch>) {
  const call = fetchMock.mock.calls.at(-1);
  if (!call) throw new Error('fetch was not called');
  const [url, init] = call;
  return { url, init: init ?? {}, headers: new Headers(init?.headers) };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('api', () => {
  it('sends a GET to the /api prefix with the cookie and without a body', async () => {
    const fetchMock = stubFetch(() => json({ user: null }));

    await api.get('/account/me');

    const { url, init, headers } = lastRequest(fetchMock);
    expect(url).toBe('/api/account/me');
    expect(init.method).toBe('GET');
    expect(init.credentials).toBe('include');
    expect(init.body).toBeUndefined();
    expect(headers.get('Accept')).toBe('application/json');
    expect(headers.has('Content-Type')).toBe(false);
  });

  it('sends a JSON body with its content type', async () => {
    const fetchMock = stubFetch(() => json({ ok: true }, 201));

    await api.post('/chat', { type: 'group', name: 'Team' });

    const { init, headers } = lastRequest(fetchMock);
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ type: 'group', name: 'Team' }));
    expect(headers.get('Content-Type')).toBe('application/json');
  });

  it('sends no body and no content type for a POST without one (logout)', async () => {
    const fetchMock = stubFetch(() => json({ user: null }));

    await api.post('/account/logout');

    const { init, headers } = lastRequest(fetchMock);
    expect(init.body).toBeUndefined();
    expect(headers.has('Content-Type')).toBe(false);
  });

  it('uses the method of each helper', async () => {
    const fetchMock = stubFetch(() => json({}));

    await api.patch('/chat/1', {});
    expect(lastRequest(fetchMock).init.method).toBe('PATCH');
    await api.put('/chat/1/read', {});
    expect(lastRequest(fetchMock).init.method).toBe('PUT');
    await api.delete('/friend/2');
    expect(lastRequest(fetchMock).init.method).toBe('DELETE');
  });

  it('returns the parsed body of a successful response', async () => {
    stubFetch(() => json({ messages: [], hasMore: false }));

    await expect(api.get('/chat/1/message')).resolves.toEqual({ messages: [], hasMore: false });
  });

  it('returns undefined for a 204, which has no body', async () => {
    stubFetch(() => new Response(null, { status: 204 }));

    await expect(api.delete('/chat/1/member/2')).resolves.toBeUndefined();
  });

  it("throws an ApiError carrying the server's { error } message and the whole body", async () => {
    stubFetch(() => json({ error: 'You are the only admin', chatIds: [3, 4] }, 409));

    const error = await api.delete('/account/me', { password: 'x' }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 409,
      message: 'You are the only admin',
      body: { error: 'You are the only admin', chatIds: [3, 4] },
    });
  });

  it('falls back to a generic message when the error body is not JSON (a proxy error page)', async () => {
    stubFetch(() => new Response('<html>Bad Gateway</html>', { status: 502 }));

    const error = await api.get('/chat').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 502, message: 'Request failed with status 502' });
  });

  it('falls back to a generic message when the body has no usable error text', async () => {
    stubFetch(() => json({ error: '   ' }, 400));

    await expect(api.get('/chat')).rejects.toMatchObject({ status: 400, message: 'Request failed with status 400' });
  });

  it('reports a request that never got an answer as an ApiError with status 0', async () => {
    stubFetch(() => Promise.reject(new TypeError('Failed to fetch')));

    const error = await api.get('/chat').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 0 });
  });

  it('lets a cancelled request through as the AbortError it is', async () => {
    const abort = new DOMException('The operation was aborted.', 'AbortError');
    stubFetch(() => Promise.reject(abort));

    await expect(api.get('/chat', { signal: new AbortController().signal })).rejects.toBe(abort);
  });

  it('passes the abort signal on to fetch', async () => {
    const fetchMock = stubFetch(() => json({}));
    const controller = new AbortController();

    await api.get('/chat', { signal: controller.signal });

    expect(lastRequest(fetchMock).init.signal).toBe(controller.signal);
  });
});
