import { useState, type SyntheticEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Form } from '@/components/ui/Form';
import { Notice } from '@/components/ui/Notice';
import { TextField } from '@/components/ui/TextField';
import { PASSWORD_HINT } from '../hints';
import { useChangePassword } from '../queries';

export function PasswordForm() {
  const change = useChangePassword();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');

  function handleSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    change.mutate(
      { currentPassword, newPassword },
      {
        onSuccess: () => {
          setCurrentPassword('');
          setNewPassword('');
        },
      },
    );
  }

  return (
    <Form onSubmit={handleSubmit}>
      <TextField
        label="Current password"
        type="password"
        name="currentPassword"
        autoComplete="current-password"
        required
        value={currentPassword}
        onChange={(event) => setCurrentPassword(event.target.value)}
      />
      <TextField
        label="New password"
        type="password"
        name="newPassword"
        autoComplete="new-password"
        required
        value={newPassword}
        onChange={(event) => setNewPassword(event.target.value)}
        hint={PASSWORD_HINT}
      />
      {change.error && (
        <Notice tone="error" role="alert">
          {change.error.message}
        </Notice>
      )}
      {change.isSuccess && (
        <Notice tone="success" role="status">
          Password changed. Every other device you were signed in on is signed out.
        </Notice>
      )}
      <Button type="submit" disabled={change.isPending}>
        {change.isPending ? 'Changing…' : 'Change password'}
      </Button>
    </Form>
  );
}
