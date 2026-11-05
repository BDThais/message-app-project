import { useNavigate } from '@tanstack/react-router';
import { useStartDirectChat } from '@/features/chats/queries';

/** "Message" on a friend: makes the direct room (or finds the one that exists) and opens it. */
export function useMessageFriend() {
  const navigate = useNavigate();
  const { mutate, isPending, error } = useStartDirectChat();

  return {
    message: (userId: number) =>
      mutate(userId, {
        onSuccess: (room) => void navigate({ to: '/chat/$chatId', params: { chatId: String(room.id) } }),
      }),
    isPending,
    error,
  };
}
