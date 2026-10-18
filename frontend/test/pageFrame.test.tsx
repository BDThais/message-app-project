// @vitest-environment jsdom
import { cleanup, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubApi } from './helpers/fakeApi';
import { renderApp } from './helpers/renderApp';

beforeEach(() => {
  window.scrollTo = vi.fn(); // jsdom has none, and the router scrolls to the top on navigation
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// The `Page` component draws the `<main>` once for each page: in a layout (`_guest`, `_public`), in the
// page itself where it has no layout (the placeholder at /chat, the not-found page). A page that writes
// its own `<main>` as well, or none, breaks the landmark that screen readers jump to.
describe('the page frame', () => {
  it.each([
    ['/login', false],
    ['/signup', false],
    ['/forgot-password', false],
    ['/verify-email', false],
    ['/verify-email', true],
    ['/reset-password', false],
    ['/reset-password#token=abc', true],
    ['/chat', true],
    ['/no-such-page', false],
  ])('%s has exactly one main landmark (signed in: %s)', async (path, signedIn) => {
    stubApi({ signedIn });
    renderApp(path);

    await screen.findByRole('main');
    expect(screen.getAllByRole('main')).toHaveLength(1);
  });
});
