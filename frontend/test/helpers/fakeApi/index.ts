import { vi } from 'vitest';
import { accountEndpoints } from './account';
import { chatEndpoints } from './chats';
import { json } from './responses';
import { createState, type Body } from './state';

export { john, NEW_PASSWORD, PASSWORD, type Call, type FakeServer } from './state';

// A fake of the server's endpoints, as a stubbed `fetch`, for the app-level tests. It follows
// api.doc.md (status codes, error texts, the snake_case request bodies) but not the server's code: it
// only has to be faithful enough for the screens to be exercised through the real router, guards and
// query client. One file per feature; each returns `undefined` for a request that is not its own.
const endpoints = [accountEndpoints, chatEndpoints];

/**
 * Starts the fake server. `signedIn` says whether the cookie in this browser belongs to John.
 * The returned object is the server's state, for tests to look at and to change.
 */
export function stubApi({ signedIn = false }: { signedIn?: boolean } = {}) {
  const state = createState({ signedIn });

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const request = `${init?.method ?? 'GET'} ${url}`;
      const body = init?.body === undefined ? undefined : (JSON.parse(String(init.body)) as Body);
      state.requests.push(request);
      state.calls.push({ request, body });
      await state.gate;

      for (const endpoint of endpoints) {
        const response = endpoint(request, body, state);
        if (response) return response;
      }
      return json({ error: `not stubbed: ${request}` }, 500);
    }),
  );

  return state;
}
