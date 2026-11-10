import { createFileRoute } from '@tanstack/react-router';
import { Page } from '@/components/ui/Page';
import { NewGroupForm } from '@/features/chats/components/NewGroupForm';
import { useFriends } from '@/features/friends/queries';

export const Route = createFileRoute('/_app/chat/new')({
  component: NewGroup,
});

// The friends feature imports the chats feature (the Message button), so the chats feature cannot import
// the friends: this route, which may use both, hands the friends down.
function NewGroup() {
  const friends = useFriends();

  return (
    <Page layout="column">
      <NewGroupForm friends={friends} />
    </Page>
  );
}
