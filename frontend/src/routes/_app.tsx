import { createFileRoute } from '@tanstack/react-router';
import { AppLayout } from '@/features/account/components/AppLayout';
import { requireUser } from '@/features/account/guards';
import { useRealtime } from '@/features/realtime/useRealtime';

// Everything behind this layout needs a signed-in user. The layout itself is in the account feature;
// the socket is opened here, and not there, because it feeds the chats and friends features, which the
// account feature may not import.
export const Route = createFileRoute('/_app')({
  // Runs before anything below renders, on every navigation into this layout.
  beforeLoad: ({ context, location }) => requireUser(context.queryClient, location.href),
  component: SignedInLayout,
});

function SignedInLayout() {
  useRealtime();
  return <AppLayout />;
}
