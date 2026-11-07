import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { ListState } from '@/components/ui/ListState';
import { useFriends, useUnfriend } from '../queries';
import type { PublicUser } from '../types';
import { useMessageFriend } from '../useMessageFriend';
import { PersonRow } from './PersonRow';
import { Section } from './Section';

export function FriendList() {
  const friends = useFriends();

  return (
    <Section title="Your friends">
      <ListState query={friends} empty="You have no friends yet. Search for a phone number above to send a request.">
        {(items) => (
          <ul className="divide-y divide-line">
            {items.map((friend) => (
              <FriendRow key={friend.id} friend={friend} />
            ))}
          </ul>
        )}
      </ListState>
    </Section>
  );
}

function FriendRow({ friend }: { friend: PublicUser }) {
  const [confirming, setConfirming] = useState(false);
  const unfriend = useUnfriend();
  const { message, isPending: isOpeningChat, error: chatError } = useMessageFriend();
  const busy = unfriend.isPending || isOpeningChat;

  return (
    <PersonRow
      person={friend}
      error={(unfriend.error ?? chatError)?.message}
      below={
        confirming && (
          <div role="group" aria-label={`Confirm unfriend ${friend.name}`} className="flex flex-wrap items-center gap-2 text-sm">
            <span>Remove {friend.name} from your friends? Your chats with them stay.</span>
            <Button type="button" variant="danger" size="xs" disabled={unfriend.isPending} onClick={() => unfriend.mutate(friend.id)}>
              Unfriend
            </Button>
            <Button type="button" variant="secondary" size="xs" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        )
      }
    >
      {!confirming && (
        <>
          <Button type="button" size="sm" aria-label={`Message ${friend.name}`} disabled={busy} onClick={() => message(friend.id)}>
            Message
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-label={`Unfriend ${friend.name}`}
            disabled={busy}
            onClick={() => setConfirming(true)}
          >
            Unfriend
          </Button>
        </>
      )}
    </PersonRow>
  );
}
