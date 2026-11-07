import { useEffect, useRef, useState } from 'react';
import { ActionMenu, type ActionMenuItem } from '@/components/ui/ActionMenu';
import { Button } from '@/components/ui/Button';
import { formatSentAt } from '../format';
import { useDeleteMessage, useEditMessage } from '../queries';
import type { Message } from '../types';
import { MessageEditor } from './MessageEditor';

type Mode = 'view' | 'edit' | 'confirmDelete';

// The time and the menu are in the page all the time and only drawn when asked for, so showing them
// moves nothing. A hover does not exist on a touch screen, and focus is how a keyboard gets there:
// a press on the message (`pinned`) is the third way in.
const hidden = 'pointer-events-none opacity-0';
const shownBy = [
  'group-hover:pointer-events-auto group-hover:opacity-100',
  'group-focus-within:pointer-events-auto group-focus-within:opacity-100',
  'has-[[aria-expanded=true]]:pointer-events-auto has-[[aria-expanded=true]]:opacity-100',
].join(' ');

/** One message: the bubble, and beside it the time and, for the person's own, a menu with Edit and Delete. */
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
  const [pinned, setPinned] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);
  const edit = useEditMessage(chatId);
  const remove = useDeleteMessage(chatId);
  const isDeleted = message.deletedAt !== null;
  // A message whose sender deleted their account (`sender` is null) belongs to nobody, so nobody can act on it.
  const canAct = mine && !isDeleted;

  useEffect(() => {
    if (!pinned) return;
    const onPress = (event: PointerEvent) => {
      if (!rowRef.current?.contains(event.target as Node)) setPinned(false);
    };
    document.addEventListener('pointerdown', onPress);
    return () => document.removeEventListener('pointerdown', onPress);
  }, [pinned]);

  const actions: ActionMenuItem[] = [
    { label: 'Edit', onSelect: () => setMode('edit') },
    { label: 'Delete', tone: 'danger', onSelect: () => setMode('confirmDelete') },
  ];

  return (
    <li className={`flex flex-col gap-1 ${mine ? 'items-end' : 'items-start'}`}>
      {showSender && !mine && <span className="text-xs text-muted">{message.sender?.name ?? 'Deleted user'}</span>}

      {mode === 'edit' && !isDeleted ? (
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
        <div ref={rowRef} className={`group flex max-w-full items-center gap-1 ${mine ? 'flex-row-reverse' : ''}`}>
          {/* A press on the bubble is for a touch screen or a mouse; the keyboard reaches the same controls by focus. */}
          <p
            onClick={() => setPinned((value) => !value)}
            className={
              isDeleted
                ? 'min-w-0 rounded-2xl border border-line px-3.5 py-2 text-base italic text-muted'
                : `min-w-0 max-w-md whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-base ${mine ? 'bg-accent text-on-accent' : 'bg-sunken text-fg'}`
            }
          >
            {isDeleted ? 'Message deleted' : message.content}
          </p>
          <div
            className={`flex shrink-0 items-center gap-1 whitespace-nowrap text-xs text-muted transition-opacity ${pinned ? 'pointer-events-auto opacity-100' : `${hidden} ${shownBy}`}`}
          >
            {message.editedAt && !isDeleted && <span>edited</span>}
            <time dateTime={message.createdAt} title={new Date(message.createdAt).toLocaleString()}>
              {formatSentAt(message.createdAt)}
            </time>
            {canAct && mode === 'view' && <ActionMenu label="Message actions" items={actions} />}
          </div>
        </div>
      )}

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
