import { createFileRoute } from '@tanstack/react-router';
import { AppLayout } from '@/features/account/components/AppLayout';
import { requireUser } from '@/features/account/guards';

// Everything behind this layout needs a signed-in user. The layout itself is in the account feature.
export const Route = createFileRoute('/_app')({
  // Runs before anything below renders, on every navigation into this layout.
  beforeLoad: ({ context, location }) => requireUser(context.queryClient, location.href),
  component: AppLayout,
});
