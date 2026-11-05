import type { UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { Notice } from '@/components/ui/Notice';

/**
 * What a list shows before it has items: loading, the server's error with a retry, or `empty`. Once
 * there are items they stay on screen, also when a refetch in the background fails.
 */
export function ListState<T>({
  query,
  empty,
  children,
}: {
  query: UseQueryResult<T[]>;
  empty: string;
  children: (items: T[]) => ReactNode;
}) {
  if (query.data === undefined) {
    return query.isError ? (
      <div className="flex flex-col items-start gap-2">
        <Notice tone="error" role="alert">
          {query.error.message}
        </Notice>
        <Button type="button" size="sm" variant="secondary" onClick={() => void query.refetch()}>
          Try again
        </Button>
      </div>
    ) : (
      <p role="status" className="text-sm text-muted">
        Loading…
      </p>
    );
  }

  if (query.data.length === 0) return <p className="text-sm text-muted">{empty}</p>;
  return <>{children(query.data)}</>;
}
