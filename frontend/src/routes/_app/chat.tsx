import { createFileRoute } from '@tanstack/react-router';
import { ChatLayout } from '@/features/chats/components/ChatLayout';

// The parent of /chat and /chat/$chatId: the room-list sidebar is in the layout, so it is not unmounted
// and mounted again when the person goes from one room to another.
export const Route = createFileRoute('/_app/chat')({ component: ChatLayout });
