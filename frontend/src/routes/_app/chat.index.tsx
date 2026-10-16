import { createFileRoute } from '@tanstack/react-router';
import { useMe } from '../../features/account/queries';

export const Route = createFileRoute('/_app/chat/')({
  component: ChatHome,
});

// Placeholder: the room list and the open conversation arrive in step 3 of frontend.doc.md.
function ChatHome() {
  const { data: user } = useMe();

  return (
    <main className="page">
      <h1>Chats</h1>
      <p>Signed in as {user?.email}.</p>
      <p>The room list is not built yet.</p>
    </main>
  );
}
