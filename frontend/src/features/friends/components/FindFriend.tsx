import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Form } from '@/components/ui/Form';
import { Notice } from '@/components/ui/Notice';
import { TextField } from '@/components/ui/TextField';
import { Section } from '@/components/ui/Section';
import { useAcceptFriendRequest, useDeleteFriendRequest, useSearchUser, useSendFriendRequest } from '../queries';
import { normalizeTel } from '../tel';
import type { SearchResult } from '../types';
import { useMessageFriend } from '../useMessageFriend';
import { PersonRow } from './PersonRow';

const TEL_HINT = 'The full number with the country code, starting with +, for example +84912345678.';

/** Search by phone number: the only way to find someone, and the answer says what the button should be. */
export function FindFriend() {
  const [typed, setTyped] = useState('');
  const [searched, setSearched] = useState<string | null>(null);
  const search = useSearchUser(searched);
  const tel = normalizeTel(typed);

  function submit(event: FormEvent) {
    event.preventDefault();
    // The same number again is a new search on purpose (the person may have been waiting for an answer).
    if (tel === searched) void search.refetch();
    else setSearched(tel);
  }

  return (
    <Section title="Add a friend">
      <Form onSubmit={submit}>
        <TextField
          label="Phone number"
          type="tel"
          inputMode="tel"
          autoComplete="off"
          value={typed}
          hint={TEL_HINT}
          onChange={(event) => setTyped(event.target.value)}
        />
        <div>
          {/* The limiter counts every request, so a double click must not send two. */}
          <Button type="submit" disabled={search.isFetching || tel === ''}>
            Search
          </Button>
        </div>
      </Form>

      {searched !== null &&
        (search.isFetching ? (
          <p role="status" className="text-sm text-muted">
            Searching…
          </p>
        ) : search.isError ? (
          <Notice tone="error" role="alert">
            {search.error.message}
          </Notice>
        ) : search.data ? (
          <ul>
            <SearchResultRow key={search.data.id} user={search.data} />
          </ul>
        ) : (
          <p role="status" className="text-sm text-muted">
            No one has that phone number.
          </p>
        ))}
    </Section>
  );
}

function SearchResultRow({ user }: { user: SearchResult }) {
  const send = useSendFriendRequest();
  const accept = useAcceptFriendRequest();
  const remove = useDeleteFriendRequest();
  const { message, isPending: isOpeningChat, error: chatError } = useMessageFriend();
  const busy = send.isPending || accept.isPending || remove.isPending || isOpeningChat;
  const error = send.error ?? accept.error ?? remove.error ?? chatError;
  const { requestId } = user;

  return (
    <PersonRow person={user} error={error?.message}>
      {user.relationship === 'self' && <span className="text-sm text-muted">This is you</span>}
      {user.relationship === 'none' && (
        <Button type="button" size="sm" disabled={busy} onClick={() => send.mutate(user.id)}>
          Add friend
        </Button>
      )}
      {user.relationship === 'request_sent' && requestId !== undefined && (
        <>
          <span className="text-sm text-muted">Request sent</span>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => remove.mutate({ requestId, userId: user.id })}
          >
            Cancel
          </Button>
        </>
      )}
      {user.relationship === 'request_received' && requestId !== undefined && (
        <Button type="button" size="sm" disabled={busy} onClick={() => accept.mutate(requestId)}>
          Accept
        </Button>
      )}
      {user.relationship === 'friend' && (
        <Button type="button" size="sm" disabled={busy} onClick={() => message(user.id)}>
          Message
        </Button>
      )}
    </PersonRow>
  );
}
