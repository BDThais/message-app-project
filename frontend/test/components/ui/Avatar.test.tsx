// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Avatar } from '@/components/ui/Avatar';

afterEach(cleanup);

describe('Avatar', () => {
  it('shows the picture, as decoration, without telling the address which page showed it', () => {
    const { container } = render(<Avatar name="Bea" url="https://example.com/bea.png" />);

    const image = container.querySelector('img');
    expect(image?.getAttribute('src')).toBe('https://example.com/bea.png');
    expect(image?.getAttribute('alt')).toBe('');
    expect(image?.getAttribute('referrerpolicy')).toBe('no-referrer');
  });

  it('falls back to initials when the picture does not load', () => {
    const { container } = render(<Avatar name="Project chat" url="https://example.com/dead.png" />);

    fireEvent.error(container.querySelector('img') as HTMLImageElement);

    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('PC')).toBeTruthy();
  });

  it.each([
    ['JohnDoe', 'J'],
    ['Project chat', 'PC'],
    ['  many   words here ', 'MW'],
    ['Ánh Tuyết', 'ÁT'],
    ['', '?'],
  ])('uses the initials of %j: %s', (name, initials) => {
    render(<Avatar name={name} url={null} />);
    expect(screen.getByText(initials)).toBeTruthy();
  });
});
