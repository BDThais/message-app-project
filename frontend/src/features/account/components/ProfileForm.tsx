import { useState, type SyntheticEvent } from 'react';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Form } from '@/components/ui/Form';
import { Notice } from '@/components/ui/Notice';
import { TextField } from '@/components/ui/TextField';
import { useUpdateProfile } from '../queries';
import type { UpdateProfileInput, User } from '../types';

/** The name and the avatar URL, the two things PATCH /api/account/me can change. Only what was changed is sent. */
export function ProfileForm({ user }: { user: User }) {
  const update = useUpdateProfile();
  const [name, setName] = useState(user.name);
  const [avatarUrl, setAvatarUrl] = useState(user.avatarUrl ?? '');

  const changes: UpdateProfileInput = {};
  if (name.trim() !== user.name) changes.name = name.trim();
  if (avatarUrl.trim() !== (user.avatarUrl ?? ''))
    changes.avatarUrl = avatarUrl.trim() === '' ? null : avatarUrl.trim();
  const dirty = changes.name !== undefined || changes.avatarUrl !== undefined;

  function handleSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    update.mutate(changes);
  }

  return (
    <Form onSubmit={handleSubmit}>
      <div className="flex items-center gap-3">
        <Avatar name={user.name} url={user.avatarUrl} />
        <p className="min-w-0 text-sm text-muted">
          <span className="block truncate">{user.email}</span>
          <span className="block truncate">{user.tel}</span>
        </p>
      </div>
      <TextField
        label="Name"
        name="name"
        autoComplete="nickname"
        required
        value={name}
        onChange={(event) => setName(event.target.value)}
        hint="Letters and digits only, no spaces. Your email address and phone number cannot be changed."
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
