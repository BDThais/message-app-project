import { Section } from '@/components/ui/Section';
import { useMe } from '../queries';
import { DeleteAccount } from './DeleteAccount';
import { PasswordForm } from './PasswordForm';
import { ProfileForm } from './ProfileForm';

/** The content of `/settings`: the profile, the password and the account's deletion. */
export function SettingsPage({ roomName }: { roomName: (chatId: number) => string }) {
  const { data: user } = useMe();
  if (!user) return null;

  return (
    <>
      <h1>Settings</h1>
      <Section title="Profile">
        <ProfileForm user={user} />
      </Section>
      <Section title="Password">
        <PasswordForm />
      </Section>
      <Section title="Delete account">
        <DeleteAccount roomName={roomName} />
      </Section>
    </>
  );
}
