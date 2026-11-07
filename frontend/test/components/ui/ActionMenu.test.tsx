// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActionMenu } from '@/components/ui/ActionMenu';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderMenu() {
  const onEdit = vi.fn();
  const onDelete = vi.fn();
  render(
    <>
      <button type="button">Outside</button>
      <ActionMenu
        label="Row actions"
        items={[
          { label: 'Edit', onSelect: onEdit },
          { label: 'Delete', onSelect: onDelete, tone: 'danger' },
        ]}
      />
    </>,
  );
  return { onEdit, onDelete, user: userEvent.setup() };
}

const trigger = () => screen.getByRole('button', { name: 'Row actions' });

describe('ActionMenu', () => {
  it('is a closed menu button until it is pressed', () => {
    renderMenu();

    expect(trigger().getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('opens a menu of the items with the focus on the first, and closes on a second press of the button', async () => {
    const { user } = renderMenu();

    await user.click(trigger());

    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('menu', { name: 'Row actions' })).toBeTruthy();
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Edit', 'Delete']);
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Edit' }));

    await user.click(trigger());
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('runs the action that was picked once, closes, and gives the focus back to the button', async () => {
    const { user, onEdit, onDelete } = renderMenu();

    await user.click(trigger());
    await user.click(screen.getByRole('menuitem', { name: 'Edit' }));

    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it('is operated with the keyboard: arrows that wrap around, Home, End, Enter, and Escape', async () => {
    const { user, onDelete } = renderMenu();
    trigger().focus();

    await user.keyboard('{Enter}');
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Edit' }));
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Delete' }));
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Edit' }));
    await user.keyboard('{ArrowUp}');
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Delete' }));
    await user.keyboard('{Home}');
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Edit' }));
    await user.keyboard('{End}{Enter}');
    expect(onDelete).toHaveBeenCalledTimes(1);

    await user.keyboard('{ArrowDown}'); // the focus is back on the button, which opens it
    expect(screen.getByRole('menu')).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it('opens on the last item when the up arrow opens it', async () => {
    const { user } = renderMenu();
    trigger().focus();

    await user.keyboard('{ArrowUp}');

    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Delete' }));
  });

  it('closes on Tab and lets the focus go on', async () => {
    const { user } = renderMenu();
    await user.click(trigger());

    await user.keyboard('{Tab}');

    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).not.toBe(trigger());
  });

  it('closes on a press outside, but not on a press inside the menu', async () => {
    const { user } = renderMenu();
    await user.click(trigger());

    fireEvent.pointerDown(screen.getByRole('menu'));
    expect(screen.getByRole('menu')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Outside' }));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes when anything scrolls, because the button it hangs from has moved', async () => {
    const { user } = renderMenu();
    await user.click(trigger());

    act(() => {
      fireEvent.scroll(document.body);
    });

    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('draws a destructive item in the danger color and the others plainly', async () => {
    const { user } = renderMenu();
    await user.click(trigger());

    expect(screen.getByRole('menuitem', { name: 'Delete' }).className).toContain('text-danger');
    expect(screen.getByRole('menuitem', { name: 'Edit' }).className).not.toContain('text-danger');
  });

  describe('placement', () => {
    /** The button is where `button` says, the menu is `menu` big; jsdom measures everything as zero. */
    function measure(button: { top: number; bottom: number; right: number }, menu: { width: number; height: number }) {
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
        const box = this.getAttribute('role') === 'menu' ? { top: 0, left: 0, right: menu.width, bottom: menu.height, ...menu } : { left: button.right - 32, ...button, width: 32, height: 32 };
        return { x: 0, y: 0, toJSON: () => ({}), ...box } as DOMRect;
      });
    }
    const menuStyle = () => screen.getByRole('menu').style;

    it('opens below the button with its right edge on the button\'s', async () => {
      measure({ top: 100, bottom: 132, right: 500 }, { width: 128, height: 80 });
      const { user } = renderMenu();

      await user.click(trigger());

      expect(menuStyle().top).toBe('136px');
      expect(menuStyle().left).toBe('372px');
      expect(menuStyle().visibility).toBe('visible');
    });

    it('opens above the button when there is no room below it', async () => {
      measure({ top: window.innerHeight - 40, bottom: window.innerHeight - 8, right: 500 }, { width: 128, height: 80 });
      const { user } = renderMenu();

      await user.click(trigger());

      expect(menuStyle().top).toBe(`${window.innerHeight - 40 - 4 - 80}px`);
    });

    it('stays inside the window at the left edge', async () => {
      measure({ top: 100, bottom: 132, right: 40 }, { width: 128, height: 80 });
      const { user } = renderMenu();

      await user.click(trigger());

      expect(menuStyle().left).toBe('8px');
    });
  });
});
