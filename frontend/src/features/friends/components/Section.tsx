import { useId, type ReactNode } from 'react';

/** A titled card of the friends page; the title names the region for a screen reader. */
export function Section({ title, children }: { title: string; children: ReactNode }) {
  const headingId = useId();

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4 sm:p-5">
      <h2 id={headingId} className="text-lg font-semibold tracking-tight">
        {title}
      </h2>
      {children}
    </section>
  );
}
