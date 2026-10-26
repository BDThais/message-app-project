import type { ReactNode } from 'react';
import { Logo } from './Logo';

/**
 * The frame of a page: the `<main>` and its width. `narrow` is a centered card under the logo, for
 * forms and short notices. `column` is a centered column that scrolls with the signed-in layout.
 * `fill` takes all the room that is left, for a screen that scrolls inside itself (the chat).
 */
export function Page({
  layout = 'column',
  children,
}: {
  layout?: 'narrow' | 'column' | 'fill';
  children: ReactNode;
}) {
  if (layout === 'narrow') {
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

  if (layout === 'fill') {
    return <main className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</main>;
  }

  return <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-4 p-4 sm:p-6">{children}</main>;
}
