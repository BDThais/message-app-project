import { useState, type SyntheticEvent } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import type { UseQueryResult } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button';
import { Form } from '@/components/ui/Form';
import { ListState } from '@/components/ui/ListState';
import { Notice } from '@/components/ui/Notice';
import { TextField } from '@/components/ui/TextField';
import { useCreateGroupChat } from '../queries';
import type { PublicUser } from '../types';
import { FriendPicker } from './FriendPicker';

/**
 * Makes a group room: an optional name and avatar, and the friends who go into it (nobody is allowed too:
 * the creator is then alone in it). The friends come from the page that uses this, because the friends
 * feature imports this one and not the other way round.
 */
export function NewGroupForm({ friends }: { friends: UseQueryResult<PublicUser[]> }) {
  const create = useCreateGroupChat();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [memberIds, setMemberIds] = useState<number[]>([]);

  function handleSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    create.mutate(
      {
        memberIds,
        ...(name.trim() !== '' && { name: name.trim() }),
        ...(avatarUrl.trim() !== '' && { avatarUrl: avatarUrl.trim() }),
      },
      { onSuccess: (room) => void navigate({ to: '/chat/$chatId', params: { chatId: String(room.id) } }) },
    );
  }

  return (
    <Form onSubmit={handleSubmit}>
      <Link to="/chat" className="text-sm no-underline md:hidden">
        <span aria-hidden="true">← </span>Chats
      </Link>
      <h1>New group</h1>
      <TextField
        label="Name"
        name="name"
        autoComplete="off"
        value={name}
        onChange={(event) => setName(event.target.value)}
        hint="Optional, up to 100 characters. A group without a name is called “Group chat”."
      />
      <TextField
        label="Avatar URL"
        type="url"
        name="avatarUrl"
        autoComplete="off"
        value={avatarUrl}
        onChange={(event) => setAvatarUrl(event.target.value)}
        hint="Optional: the address of a picture on the web, starting with http:// or https://."
      />
      <ListState query={friends} empty="You have no friends to add yet. You can make the group and add people later.">
        {(items) => <FriendPicker legend="Add friends" friends={items} selected={memberIds} onChange={setMemberIds} />}
      </ListState>
      {create.error && (
        <Notice tone="error" role="alert">
          {create.error.message}
        </Notice>
      )}
      <Button type="submit" disabled={create.isPending}>
        {create.isPending ? 'Creating…' : 'Create group'}
      </Button>
    </Form>
  );
}
