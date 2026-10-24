import type { ReactNode } from 'react';
import { Logo } from './Logo';

/**
 * The frame of a page: the `<main>` and its width. `narrow` is a centered card under the logo, for
 * forms and short notices; the other one is a column inside the signed-in layout.
 */
export function Page({ narrow = false, children }: { narrow?: boolean; children: ReactNode }) {
  if (!narrow) {
    return <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-4 p-4 sm:p-6">{children}</main>;
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 p-4">
      <Logo />
      <div
        className="flex w-full max-w-sm flex-col gap-5 rounded-2xl border border-line bg-surface p-6 shadow-sm sm:p-8"
      >
        {children}
      </div>
    </main>
  );
}
