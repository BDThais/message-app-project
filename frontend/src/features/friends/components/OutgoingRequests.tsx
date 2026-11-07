import { Button } from '@/components/ui/Button';
import { ListState } from '@/components/ui/ListState';
import { useDeleteFriendRequest, useFriendRequests } from '../queries';
import type { FriendRequest } from '../types';
import { PersonRow } from './PersonRow';
import { Section } from './Section';

/** `onNews` gets the text of an action that found the page out of date, for a row the refresh then takes away. */
export function OutgoingRequests({ onNews }: { onNews: (text: string) => void }) {
  const requests = useFriendRequests('outgoing');

  return (
    <Section title="Requests you sent">
      <ListState query={requests} empty="You have no requests waiting for an answer.">
        {(items) => (
          <ul className="divide-y divide-line">
            {items.map((request) => (
              <OutgoingRow key={request.id} request={request} onNews={onNews} />
            ))}
          </ul>
        )}
      </ListState>
    </Section>
  );
}

function OutgoingRow({ request, onNews }: { request: FriendRequest; onNews: (text: string) => void }) {
  const cancel = useDeleteFriendRequest((text) => onNews(`${request.user.name}: ${text}`));

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
