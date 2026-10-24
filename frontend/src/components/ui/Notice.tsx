import type { ReactNode } from 'react';

const tones = {
  info: 'border-accent/30 bg-accent-soft text-fg',
  success: 'border-success/30 bg-success-soft text-success',
  error: 'border-danger/30 bg-danger-soft text-danger',
} as const;

/** `role` is the caller's to give: `alert` for an error that has just appeared, `status` for progress or a result. */
export function Notice({
  tone,
  role,
  children,
}: {
  tone: keyof typeof tones;
  role?: 'alert' | 'status';
  children: ReactNode;
}) {
  return (
    <div role={role} className={`rounded-lg border px-3.5 py-2.5 text-sm ${tones[tone]}`}>
      {children}
    </div>
  );
}
