import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { formatSentAt } from '../format';
import { useDeleteMessage, useEditMessage } from '../queries';
import type { Message } from '../types';
import { MessageEditor } from './MessageEditor';

type Mode = 'view' | 'edit' | 'confirmDelete';

/** One message: a bubble, its time, and (for the person's own) Edit and Delete. */
export function MessageItem({
  message,
  chatId,
  mine,
  showSender,
}: {
  message: Message;
  chatId: number;
  mine: boolean;
  /** Group rooms name the sender above each message that is not the person's own. */
  showSender: boolean;
}) {
  const [mode, setMode] = useState<Mode>('view');
  const edit = useEditMessage(chatId);
  const remove = useDeleteMessage(chatId);
  const isDeleted = message.deletedAt !== null;
  // A message whose sender deleted their account (`sender` is null) belongs to nobody, so nobody can act on it.
  const canAct = mine && !isDeleted;

  return (
    <li className={`flex flex-col gap-1 ${mine ? 'items-end' : 'items-start'}`}>
      {showSender && !mine && <span className="text-xs text-muted">{message.sender?.name ?? 'Deleted user'}</span>}

      {isDeleted ? (
        <p className="rounded-2xl border border-line px-3.5 py-2 text-base italic text-muted">Message deleted</p>
      ) : mode === 'edit' ? (
        <MessageEditor
          label="Edit message"
          initialValue={message.content}
          submitLabel="Save"
          autoFocus
          onSubmit={(content) => edit.mutateAsync({ messageId: message.id, content }).then(() => setMode('view'))}
          onCancel={() => setMode('view')}
          isPending={edit.isPending}
          error={edit.error?.message}
        />
      ) : (
        <p
          className={`max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-base sm:max-w-md ${mine ? 'bg-accent text-on-accent' : 'bg-sunken text-fg'}`}
        >
          {message.content}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
        <time dateTime={message.createdAt} title={new Date(message.createdAt).toLocaleString()}>
          {formatSentAt(message.createdAt)}
        </time>
        {message.editedAt && !isDeleted && <span>edited</span>}
        {canAct && mode === 'view' && (
          <>
            <Button type="button" variant="ghost" size="xs" onClick={() => setMode('edit')}>
              Edit
            </Button>
            <Button type="button" variant="ghost" size="xs" onClick={() => setMode('confirmDelete')}>
              Delete
            </Button>
          </>
        )}
      </div>

      {canAct && mode === 'confirmDelete' && (
        <div role="group" aria-label="Confirm delete" className="flex flex-wrap items-center gap-2 text-sm">
          <span>Delete this message for everyone?</span>
          <Button
            type="button"
            variant="danger"
            size="xs"
            disabled={remove.isPending}
            onClick={() => remove.mutate(message.id, { onSuccess: () => setMode('view') })}
          >
            {remove.isPending ? 'Deleting…' : 'Delete'}
          </Button>
          <Button type="button" variant="secondary" size="xs" onClick={() => setMode('view')}>
            Cancel
          </Button>
        </div>
      )}
      {remove.error && (
        <p role="alert" className="text-sm text-danger">
          {remove.error.message}
        </p>
      )}
    </li>
  );
}
