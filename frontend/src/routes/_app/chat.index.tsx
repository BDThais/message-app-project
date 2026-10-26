import { createFileRoute } from '@tanstack/react-router';
import { Page } from '@/components/ui/Page';

export const Route = createFileRoute('/_app/chat/')({
  component: ChatHome,
});

// On a phone the room list is the whole screen at /chat, so this is only for wide screens.
function ChatHome() {
  return (
    <Page layout="fill">
      <div className="hidden flex-1 items-center justify-center p-6 text-muted md:flex">
        <p>Select a chat to read and write messages.</p>
      </div>
    </Page>
  );
}
