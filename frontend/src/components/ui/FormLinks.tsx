import type { ReactNode } from 'react';

/** The links under a form or a notice: where to go next. */
export function FormLinks({ children }: { children: ReactNode }) {
  return <p className="flex flex-wrap gap-x-5 gap-y-2 text-sm">{children}</p>;
}
