import { Button } from '@/components/ui/Button';
import { ListState } from '@/components/ui/ListState';
import { useAcceptFriendRequest, useDeleteFriendRequest, useFriendRequests } from '../queries';
import type { FriendRequest } from '../types';
import { PersonRow } from './PersonRow';
import { Section } from './Section';

export function IncomingRequests() {
  const requests = useFriendRequests('incoming');

  return (
    <Section title="Friend requests">
      <ListState query={requests} empty="No one is waiting for an answer.">
        {(items) => (
          <ul className="divide-y divide-line">
            {items.map((request) => (
              <IncomingRow key={request.id} request={request} />
            ))}
          </ul>
        )}
      </ListState>
    </Section>
  );
}

function IncomingRow({ request }: { request: FriendRequest }) {
  const accept = useAcceptFriendRequest();
  const reject = useDeleteFriendRequest();
  const busy = accept.isPending || reject.isPending;
  const { name } = request.user;

  return (
    <PersonRow person={request.user} error={(accept.error ?? reject.error)?.message}>
      <Button type="button" size="sm" aria-label={`Accept ${name}`} disabled={busy} onClick={() => accept.mutate(request.id)}>
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
