import type { UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Button } from './Button';
import { Notice } from './Notice';

/**
 * What a list shows before it has items: loading, the server's error with a retry, or `empty`. Once
 * there are items they stay on screen, also when a refetch in the background fails. `inset` indents
 * these states like the text of a list whose rows run from edge to edge.
 */
export function ListState<T>({
  query,
  empty,
  loading = 'Loading…',
  inset = false,
  children,
}: {
  query: UseQueryResult<T[]>;
  empty: string;
  loading?: string;
  inset?: boolean;
  children: (items: T[]) => ReactNode;
}) {
  const indent = inset ? ' px-4' : '';

  if (query.data === undefined) {
    return query.isError ? (
      <div className={`flex flex-col items-start gap-2${indent}`}>
        <Notice tone="error" role="alert">
          {query.error.message}
        </Notice>
        <Button type="button" size="sm" variant="secondary" onClick={() => void query.refetch()}>
          Try again
        </Button>
      </div>
    ) : (
      <p role="status" className={`text-sm text-muted${indent}`}>
        {loading}
      </p>
    );
  }

  if (query.data.length === 0) return <p className={`text-sm text-muted${indent}`}>{empty}</p>;
  return <>{children(query.data)}</>;
}
