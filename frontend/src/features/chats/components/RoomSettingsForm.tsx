import { useState, type SyntheticEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Form } from '@/components/ui/Form';
import { Notice } from '@/components/ui/Notice';
import { TextField } from '@/components/ui/TextField';
import type { UpdateRoomInput } from '../api';
import { useUpdateChatRoom } from '../queries';
import type { ChatRoomSummary } from '../types';

/** The name and the avatar URL of a group room (admins only: the caller decides who sees this). Only what was changed is sent. */
export function RoomSettingsForm({ room }: { room: ChatRoomSummary }) {
  const update = useUpdateChatRoom(room.id);
  const [name, setName] = useState(room.name ?? '');
  const [avatarUrl, setAvatarUrl] = useState(room.avatarUrl ?? '');

  const changes: UpdateRoomInput = {};
  if (name.trim() !== (room.name ?? '')) changes.name = name.trim();
  if (avatarUrl.trim() !== (room.avatarUrl ?? ''))
    changes.avatarUrl = avatarUrl.trim() === '' ? null : avatarUrl.trim();
  const dirty = changes.name !== undefined || changes.avatarUrl !== undefined;

  function handleSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    update.mutate(changes);
  }

  return (
    <Form onSubmit={handleSubmit}>
      <TextField
        label="Group name"
        name="name"
        autoComplete="off"
        value={name}
        onChange={(event) => setName(event.target.value)}
        hint="Up to 100 characters."
      />
      <TextField
        label="Avatar URL"
        type="url"
        name="avatarUrl"
        autoComplete="off"
        value={avatarUrl}
        onChange={(event) => setAvatarUrl(event.target.value)}
        hint="The address of a picture on the web, starting with http:// or https://. Leave it empty for no picture."
      />
      {update.error && (
        <Notice tone="error" role="alert">
          {update.error.message}
        </Notice>
      )}
      {update.isSuccess && !dirty && (
        <Notice tone="success" role="status">
          Saved.
        </Notice>
      )}
      <Button type="submit" disabled={!dirty || update.isPending}>
        {update.isPending ? 'Saving…' : 'Save changes'}
      </Button>
    </Form>
  );
}
