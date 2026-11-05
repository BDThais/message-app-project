import { createFileRoute } from '@tanstack/react-router';
import { Page } from '@/components/ui/Page';
import { FriendsPage } from '@/features/friends/components/FriendsPage';

export const Route = createFileRoute('/_app/friends')({
  component: () => (
    <Page layout="column">
      <FriendsPage />
    </Page>
  ),
});
