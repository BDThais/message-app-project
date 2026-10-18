import type { ReactNode } from 'react';

/** The frame of a page: the `<main>` and its width. `narrow` is for forms and short notices. */
export function Page({ narrow = false, children }: { narrow?: boolean; children: ReactNode }) {
  return <main className={narrow ? 'page page-narrow' : 'page'}>{children}</main>;
}
