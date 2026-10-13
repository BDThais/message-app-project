// The one place that talks to the server. Every feature's api.ts goes through `api`.
//
// In development the paths below go to the Vite dev server, which forwards `/api/...` to the
// Express server and removes the prefix (see vite.config.ts). In production the same prefix is
// expected to be routed to the API by whatever serves the app (see frontend-planning-doc.md).

export const API_BASE = '/api';

/** A failed request: the server answered with a non-2xx status, or never answered (status 0). */
export class ApiError extends Error {
  readonly status: number;
  /** The parsed response body, for the few errors that carry more than `{ error }` (e.g. `chatIds` on a 409). */
  readonly body: unknown;

  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

interface RequestOptions {
  body?: unknown;
  /** Passed through to fetch; TanStack Query hands one to every query function. */
  signal?: AbortSignal | undefined;
}

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

const NETWORK_ERROR_MESSAGE = 'Could not reach the server. Check your connection and try again.';

// The server's error bodies are `{ error: string }`.
function errorMessageFrom(body: unknown): string | undefined {
  if (typeof body === 'object' && body !== null && 'error' in body) {
    const { error } = body as { error: unknown };
    if (typeof error === 'string' && error.trim() !== '') return error;
  }
  return undefined;
}

// Several endpoints (DELETE member, POST /account/password, ...) answer 204 with no body at all;
// an empty body reads as `undefined`, so those calls resolve to `undefined`.
async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text === '') return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined; // not JSON (an HTML error page from a proxy, for example)
  }
}

async function request<T>(method: Method, path: string, { body, signal }: RequestOptions = {}): Promise<T> {
  const headers = new Headers({ Accept: 'application/json' });
  const init: RequestInit = { method, headers, credentials: 'include' };
  if (body !== undefined) {
    headers.set('Content-Type', 'application/json');
    init.body = JSON.stringify(body);
  }
  if (signal) init.signal = signal;

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, init);
  } catch (error) {
    // A cancelled query is not a failure; let it through untouched.
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError(0, NETWORK_ERROR_MESSAGE);
  }

  const data = await readBody(response);
  if (!response.ok) {
    throw new ApiError(response.status, errorMessageFrom(data) ?? `Request failed with status ${response.status}`, data);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string, options?: Omit<RequestOptions, 'body'>) => request<T>('GET', path, options),
  post: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'body'>) =>
    request<T>('POST', path, { ...options, body }),
  patch: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'body'>) =>
    request<T>('PATCH', path, { ...options, body }),
  put: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'body'>) =>
    request<T>('PUT', path, { ...options, body }),
  delete: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'body'>) =>
    request<T>('DELETE', path, { ...options, body }),
};
