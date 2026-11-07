import { Button } from '@/components/ui/Button';
import { ListState } from '@/components/ui/ListState';
import { useDeleteFriendRequest, useFriendRequests } from '../queries';
import type { FriendRequest } from '../types';
import { PersonRow } from './PersonRow';
import { Section } from './Section';

export function OutgoingRequests() {
  const requests = useFriendRequests('outgoing');

  return (
    <Section title="Requests you sent">
      <ListState query={requests} empty="You have no requests waiting for an answer.">
        {(items) => (
          <ul className="divide-y divide-line">
            {items.map((request) => (
              <OutgoingRow key={request.id} request={request} />
            ))}
          </ul>
        )}
      </ListState>
    </Section>
  );
}

function OutgoingRow({ request }: { request: FriendRequest }) {
  const cancel = useDeleteFriendRequest();

  return (
    <PersonRow person={request.user} error={cancel.error?.message}>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        aria-label={`Cancel request to ${request.user.name}`}
        disabled={cancel.isPending}
        onClick={() => cancel.mutate({ requestId: request.id, userId: request.user.id })}
      >
        Cancel
      </Button>
    </PersonRow>
  );
}
