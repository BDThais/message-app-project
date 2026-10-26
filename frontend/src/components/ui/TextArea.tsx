import { useId, type TextareaHTMLAttributes } from 'react';

interface TextAreaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id' | 'className'> {
  label: string;
  /** For a field whose purpose is clear from where it is (the message box): the label stays for screen readers. */
  hideLabel?: boolean;
}

/** A labelled multi-line input that grows with its text, up to a limit (where the browser supports `field-sizing`). */
export function TextArea({ label, hideLabel = false, ...textareaProps }: TextAreaProps) {
  const id = useId();

  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className={hideLabel ? 'sr-only' : 'text-sm font-medium'}>
        {label}
      </label>
      {/* 16px text: iOS Safari zooms into any field set smaller. */}
      <textarea
        id={id}
        rows={1}
        className="max-h-40 min-h-11 w-full resize-none rounded-lg border border-edge bg-surface px-3 py-2.5 text-base text-fg field-sizing-content placeholder:text-muted focus-visible:border-accent focus-visible:outline-offset-0"
        {...textareaProps}
      />
    </div>
  );
}
