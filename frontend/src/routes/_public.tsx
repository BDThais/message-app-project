import { createFileRoute, Outlet } from '@tanstack/react-router';
import { Page } from '../components/ui/Page';

// Pages that work whether or not the person is signed in: the ones the emailed links open
// (/verify-email, /reset-password). There is no guard here on purpose. They have a layout of their
// own, instead of standing outside the layouts, so that the page frame is written in one place.
export const Route = createFileRoute('/_public')({
  component: () => (
    <Page narrow>
      <Outlet />
    </Page>
  ),
});
