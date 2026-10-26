import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { isApiError } from './http';

const MAX_RETRIES = 2;

/**
 * A 4xx answer is the server's final word (wrong input, not allowed, not found), so asking again
 * cannot change it. Only a lost connection (status 0), a 5xx or an unexpected error is worth a retry.
 */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (isApiError(error) && error.status >= 400 && error.status < 500) return false;
  return failureCount < MAX_RETRIES;
}

interface QueryClientOptions {
  /**
   * Called when any query or mutation fails with a 401. A 401 does not always mean "the session is
   * gone" (a wrong current password on POST /api/account/password is a 401 too), so the caller should
   * re-check the session (refetch GET /api/account/me) instead of signing the user out blindly.
   */
  onUnauthorized: () => void;
}

export function createQueryClient({ onUnauthorized }: QueryClientOptions): QueryClient {
  const handleError = (error: unknown) => {
    if (isApiError(error) && error.status === 401) onUnauthorized();
  };

  return new QueryClient({
    queryCache: new QueryCache({ onError: handleError }),
    mutationCache: new MutationCache({ onError: handleError }),
    defaultOptions: {
      queries: {
        retry: shouldRetry,
        staleTime: 30_000,
      },
    },
  });
}
