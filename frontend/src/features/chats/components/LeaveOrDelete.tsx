import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Button } from '@/components/ui/Button';
import { Notice } from '@/components/ui/Notice';
import { useDeleteChatRoom, useLeaveChatRoom } from '../queries';

/** Leaving the group, for every member, and deleting it, for admins. Each asks first, and both end in the room list. */
export function LeaveOrDelete({ chatId, userId, isAdmin }: { chatId: number; userId: number; isAdmin: boolean }) {
  const [asking, setAsking] = useState<'leave' | 'delete' | null>(null);
  const leave = useLeaveChatRoom(chatId, userId);
  const remove = useDeleteChatRoom(chatId);
  const navigate = useNavigate();
  const toRoomList = () => void navigate({ to: '/chat' });

  const error = leave.error ?? remove.error;
  const pending = leave.isPending || remove.isPending;

  function cancel() {
    setAsking(null);
    leave.reset();
    remove.reset();
  }

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <Notice tone="error" role="alert">
          {error.message}
        </Notice>
      )}
      {asking === null && (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={() => setAsking('leave')}>
            Leave group…
          </Button>
          {isAdmin && (
            <Button type="button" variant="danger" onClick={() => setAsking('delete')}>
              Delete group…
            </Button>
          )}
        </div>
      )}
      {asking === 'leave' && (
        <div role="group" aria-label="Confirm leaving" className="flex flex-col gap-2 text-sm">
          <p>Leave this group? You will not see its messages any more, and an admin has to add you again.</p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="danger"
              disabled={pending}
              onClick={() => leave.mutate(undefined, { onSuccess: toRoomList })}
            >
              {leave.isPending ? 'Leaving…' : 'Leave group'}
            </Button>
            <Button type="button" variant="secondary" onClick={cancel}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {asking === 'delete' && (
        <div role="group" aria-label="Confirm deleting" className="flex flex-col gap-2 text-sm">
          <p>Delete this group and all its messages for everyone? This cannot be undone.</p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="danger"
              disabled={pending}
              onClick={() => remove.mutate(undefined, { onSuccess: toRoomList })}
            >
              {remove.isPending ? 'Deleting…' : 'Delete group'}
            </Button>
            <Button type="button" variant="secondary" onClick={cancel}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
