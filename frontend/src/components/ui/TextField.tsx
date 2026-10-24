import { useId, type InputHTMLAttributes, type ReactNode } from 'react';

interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'className'> {
  label: string;
  /** Shown under the input and read out with it (`aria-describedby`). Kept out of the label on purpose. */
  hint?: ReactNode;
}

/** A labelled input. The label and the hint are wired to the input, so a screen reader reads both. */
export function TextField({ label, hint, ...inputProps }: TextFieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;

  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {/* 16px text: iOS Safari zooms into any field set smaller. */}
      <input
        id={id}
        aria-describedby={hint ? hintId : undefined}
        className="h-11 w-full rounded-lg border border-edge bg-surface px-3 text-base text-fg placeholder:text-muted focus-visible:border-accent focus-visible:outline-offset-0"
        {...inputProps}
      />
      {hint && (
        <p id={hintId} className="text-sm text-muted">
          {hint}
        </p>
      )}
    </div>
  );
}
