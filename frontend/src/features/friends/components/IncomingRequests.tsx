import { Button } from '@/components/ui/Button';
import { ListState } from '@/components/ui/ListState';
import { Section } from '@/components/ui/Section';
import { useAcceptFriendRequest, useDeleteFriendRequest, useFriendRequests } from '../queries';
import type { FriendRequest } from '../types';
import { PersonRow } from './PersonRow';

/** `onNews` gets the text of an action that found the page out of date, for a row the refresh then takes away. */
export function IncomingRequests({ onNews }: { onNews: (text: string) => void }) {
  const requests = useFriendRequests('incoming');

  return (
    <Section title="Friend requests">
      <ListState query={requests} empty="No one is waiting for an answer.">
        {(items) => (
          <ul className="divide-y divide-line">
            {items.map((request) => (
              <IncomingRow key={request.id} request={request} onNews={onNews} />
            ))}
          </ul>
        )}
      </ListState>
    </Section>
  );
}

function IncomingRow({ request, onNews }: { request: FriendRequest; onNews: (text: string) => void }) {
  const { name } = request.user;
  const report = (text: string) => onNews(`${name}: ${text}`);
  const accept = useAcceptFriendRequest(report);
  const reject = useDeleteFriendRequest(report);
  const busy = accept.isPending || reject.isPending;

  return (
    <PersonRow person={request.user} error={(accept.error ?? reject.error)?.message}>
      <Button
        type="button"
        size="sm"
        aria-label={`Accept ${name}`}
        disabled={busy}
        onClick={() => accept.mutate(request.id)}
      >
        Accept
      </Button>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        aria-label={`Reject ${name}`}
        disabled={busy}
        onClick={() => reject.mutate({ requestId: request.id, userId: request.user.id })}
      >
        Reject
      </Button>
    </PersonRow>
  );
}
