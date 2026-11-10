import { useState, type SyntheticEvent } from 'react';
import { Link } from '@tanstack/react-router';
import { Button } from '@/components/ui/Button';
import { Form } from '@/components/ui/Form';
import { Notice } from '@/components/ui/Notice';
import { TextField } from '@/components/ui/TextField';
import { blockingRoomIds, useDeleteAccount } from '../queries';

/**
 * Deleting the account, behind a button and then the password. When the server refuses because the
 * person is the only admin of group rooms that still have other members, the rooms are listed as
 * links, named by `roomName` (the account feature does not know the rooms, the page that uses it does).
 */
export function DeleteAccount({ roomName }: { roomName: (chatId: number) => string }) {
  const remove = useDeleteAccount();
  const [confirming, setConfirming] = useState(false);
  const [password, setPassword] = useState('');
  const blockingRooms = blockingRoomIds(remove.error);

  function handleSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    remove.mutate(password);
  }

  if (!confirming) {
    return (
      <>
        <p className="text-sm text-muted">
          Deletes your account, your private chat and its messages. Your messages in other chats stay there, without
          your name. This cannot be undone.
        </p>
        <div>
          <Button type="button" variant="danger" onClick={() => setConfirming(true)}>
            Delete my account…
          </Button>
        </div>
      </>
    );
  }

  return (
    <Form onSubmit={handleSubmit}>
      <TextField
        label="Your password"
        type="password"
        name="password"
        autoComplete="current-password"
        required
        autoFocus
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        hint="Type it to confirm that you want to delete your account."
      />
      {remove.error && (
        <Notice tone="error" role="alert">
          {remove.error.message}
        </Notice>
      )}
      {blockingRooms.length > 0 && (
        <ul aria-label="Rooms to sort out first" className="grid gap-1 text-sm">
          {blockingRooms.map((chatId) => (
            <li key={chatId}>
              <Link to="/chat/$chatId" params={{ chatId: String(chatId) }} search={{ members: true }}>
                {roomName(chatId)}
              </Link>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="danger" disabled={remove.isPending}>
          {remove.isPending ? 'Deleting…' : 'Delete my account'}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            setConfirming(false);
            setPassword('');
            remove.reset();
          }}
        >
          Cancel
        </Button>
      </div>
    </Form>
  );
}
