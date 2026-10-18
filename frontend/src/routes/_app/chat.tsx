import { createFileRoute } from '@tanstack/react-router';

// The parent of /chat and /chat/$chatId. Step 3 puts the room-list sidebar here, once, so it is not
// unmounted and mounted again when the person goes from one room to another; the pages below render
// only the conversation. Until then it shows just the page: a route without a component renders its
// child.
export const Route = createFileRoute('/_app/chat')({});
