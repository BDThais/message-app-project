import { useState, type KeyboardEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { TextArea } from '@/components/ui/TextArea';

const MAX_MESSAGE_LENGTH = 4000;

interface MessageEditorProps {
  label: string;
  placeholder?: string;
  initialValue?: string;
  submitLabel: string;
  /** Resolves when the message went through, and rejects when it did not (the text then stays in the box). */
  onSubmit: (content: string) => Promise<unknown>;
  onCancel?: () => void;
  isPending: boolean;
  error?: string | undefined;
  autoFocus?: boolean;
  /** Empty the box once the message went through: for a new message, not for an edit. */
  clearOnSubmit?: boolean;
}

/** The box for writing a message or changing one: Enter sends, Shift+Enter starts a new line, Escape cancels an edit. */
export function MessageEditor({
  label,
  placeholder,
  initialValue = '',
  submitLabel,
  onSubmit,
  onCancel,
  isPending,
  error,
  autoFocus = false,
  clearOnSubmit = false,
}: MessageEditorProps) {
  const [value, setValue] = useState(initialValue);
  const content = value.trim();
  const canSubmit = content !== '' && !isPending;

  async function submit() {
    if (!canSubmit) return;
    try {
      await onSubmit(content);
      if (clearOnSubmit) setValue('');
    } catch {
      // The caller's mutation keeps the error and passes it back as `error`; the text stays so nothing is lost.
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // isComposing: with an input method (Telex, VNI, ...) Enter can confirm the word being typed, and must not send.
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit();
    } else if (event.key === 'Escape' && onCancel) {
      onCancel();
    }
  }

  return (
    <div className="flex w-full flex-col gap-1.5">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="min-w-48 flex-1">
          <TextArea
            label={label}
            hideLabel
            placeholder={placeholder}
            value={value}
            maxLength={MAX_MESSAGE_LENGTH}
            autoFocus={autoFocus}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={onKeyDown}
          />
        </div>
        {onCancel && (
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" disabled={!canSubmit}>
          {isPending ? 'Sending…' : submitLabel}
        </Button>
      </form>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
