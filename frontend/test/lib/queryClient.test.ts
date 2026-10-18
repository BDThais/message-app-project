import { MutationObserver } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/http';
import { createQueryClient, shouldRetry } from '@/lib/queryClient';

describe('shouldRetry', () => {
  it.each([400, 401, 403, 404, 409, 429])('never retries a %i, the server has given its answer', (status) => {
    expect(shouldRetry(0, new ApiError(status, 'no'))).toBe(false);
  });

  it.each([0, 500, 502])('retries status %i twice', (status) => {
    const error = new ApiError(status, 'down');
    expect(shouldRetry(0, error)).toBe(true);
    expect(shouldRetry(1, error)).toBe(true);
    expect(shouldRetry(2, error)).toBe(false);
  });

  it('retries an unexpected error twice', () => {
    expect(shouldRetry(1, new Error('boom'))).toBe(true);
    expect(shouldRetry(2, new Error('boom'))).toBe(false);
  });
});

describe('createQueryClient onUnauthorized', () => {
  function setup() {
    const onUnauthorized = vi.fn();
    return { onUnauthorized, queryClient: createQueryClient({ onUnauthorized }) };
  }

  const failingQuery = (error: unknown) => ({
    queryKey: ['x'],
    queryFn: () => Promise.reject(error),
    retry: false,
  });

  it('is called when a query fails with a 401', async () => {
    const { onUnauthorized, queryClient } = setup();

    await expect(queryClient.query(failingQuery(new ApiError(401, 'Unauthorized')))).rejects.toThrow();

    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('is called when a mutation fails with a 401', async () => {
    const { onUnauthorized, queryClient } = setup();
    const observer = new MutationObserver(queryClient, {
      mutationFn: () => Promise.reject(new ApiError(401, 'Current password is wrong')),
    });

    await expect(observer.mutate()).rejects.toThrow();

    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('is not called for other failures', async () => {
    const { onUnauthorized, queryClient } = setup();

    await expect(queryClient.query(failingQuery(new ApiError(403, 'Forbidden')))).rejects.toThrow();
    await expect(queryClient.query({ ...failingQuery(new Error('boom')), queryKey: ['y'] })).rejects.toThrow();

    expect(onUnauthorized).not.toHaveBeenCalled();
  });
});
