import { createFileRoute, redirect } from '@tanstack/react-router';
import { DEFAULT_SIGNED_IN_PATH } from '../features/account/guards';

// "/" has nothing of its own. Signed-out visitors are bounced on to /login by the _app guard.
export const Route = createFileRoute('/')({
  beforeLoad: () => {
    throw redirect({ to: DEFAULT_SIGNED_IN_PATH });
  },
});
