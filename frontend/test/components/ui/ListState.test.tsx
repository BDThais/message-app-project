// @vitest-environment jsdom
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ListState } from '@/components/ui/ListState';

afterEach(cleanup);

/** A real query over `queryFn`, so the component gets what a screen gets and not a hand-made result. */
function Harness({ queryFn, inset }: { queryFn: () => Promise<string[]>; inset?: boolean }) {
  const query = useQuery({ queryKey: ['items'], queryFn, retry: false });
  return (
    <ListState query={query} empty="Nothing here." loading="Loading things…" inset={inset ?? false}>
      {(items) => (
        <ul>
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
    </ListState>
  );
}

function renderList(queryFn: () => Promise<string[]>, inset = false) {
  const queryClient = new QueryClient();
  const view = render(
    <QueryClientProvider client={queryClient}>
      <Harness queryFn={queryFn} inset={inset} />
    </QueryClientProvider>,
  );
  return { queryClient, ...view };
}

describe('ListState', () => {
  it('says it is loading with the text it is given, then shows the items', async () => {
    renderList(() => Promise.resolve(['Bea']));

    expect(screen.getByRole('status').textContent).toBe('Loading things…');
    expect(await screen.findByText('Bea')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('says the list is empty', async () => {
    renderList(() => Promise.resolve([]));

    expect(await screen.findByText('Nothing here.')).toBeTruthy();
  });

  it('shows the error with a way to try again, and the items when the retry works', async () => {
    const queryFn = vi
      .fn<() => Promise<string[]>>()
      .mockRejectedValueOnce(new Error('The server is down'))
      .mockResolvedValue(['Bea']);
    renderList(queryFn);

    expect((await screen.findByRole('alert')).textContent).toBe('The server is down');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('Bea')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps the items on screen when a refetch in the background fails', async () => {
    const queryFn = vi
      .fn<() => Promise<string[]>>()
      .mockResolvedValueOnce(['Bea'])
      .mockRejectedValue(new Error('The server is down'));
    const { queryClient } = renderList(queryFn);
    await screen.findByText('Bea');

    // TanStack Query tells its observers on a zero timeout: without the extra tick the failure has not
    // reached the screen yet, and the checks below pass whatever the component does.
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ['items'] });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(queryFn).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Bea')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('indents its states only when asked to', async () => {
    const withInset = renderList(() => Promise.resolve([]), true);
    expect(withInset.getByRole('status').className).toContain('px-4');
    withInset.unmount();

    const without = renderList(() => Promise.resolve([]));
    expect(without.getByRole('status').className).not.toContain('px-4');
  });
});
