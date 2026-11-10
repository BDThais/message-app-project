import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Button } from './Button';

export interface ActionMenuItem {
  label: string;
  onSelect: () => void;
  /** A destructive action is drawn in the danger color. */
  tone?: 'danger';
}

const EDGE = 8;
const GAP = 4;

/**
 * A button with three vertical dots that opens a menu of actions, the way to give a row more actions
 * than it has room for. The menu is `fixed` to the window so the scrolling list the row is in cannot
 * clip it, and it opens upward when there is no room below. Arrow keys, Home and End move between the
 * items, Escape closes it and gives the focus back to the button, and a press outside or a scroll
 * closes it.
 */
export function ActionMenu({ label, items }: { label: string; items: ActionMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<{ top: number; left: number } | null>(null);
  const [focusLast, setFocusLast] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  function close(giveFocusBack: boolean) {
    setOpen(false);
    setPlace(null);
    if (giveFocusBack) triggerRef.current?.focus();
  }

  // Measured once the menu is in the page and before it is painted, so it never shows in the wrong place.
  useLayoutEffect(() => {
    if (!open || !triggerRef.current || !menuRef.current) return;
    const trigger = triggerRef.current.getBoundingClientRect();
    const menu = menuRef.current.getBoundingClientRect();
    const below = trigger.bottom + GAP;
    const top =
      below + menu.height + EDGE > window.innerHeight ? Math.max(EDGE, trigger.top - GAP - menu.height) : below;
    const left = Math.min(Math.max(EDGE, trigger.right - menu.width), window.innerWidth - menu.width - EDGE);
    setPlace({ top, left });
  }, [open]);

  useEffect(() => {
    if (!place || !menuRef.current) return;
    const entries = menuRef.current.querySelectorAll<HTMLElement>('[role="menuitem"]');
    (focusLast ? entries[entries.length - 1] : entries[0])?.focus();
  }, [place, focusLast]);

  useEffect(() => {
    if (!open) return;
    const closeQuietly = () => {
      setOpen(false);
      setPlace(null);
    };
    const onPress = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !triggerRef.current?.contains(target)) closeQuietly();
    };
    document.addEventListener('pointerdown', onPress);
    window.addEventListener('scroll', closeQuietly, true);
    window.addEventListener('resize', closeQuietly);
    return () => {
      document.removeEventListener('pointerdown', onPress);
      window.removeEventListener('scroll', closeQuietly, true);
      window.removeEventListener('resize', closeQuietly);
    };
  }, [open]);

  function onTriggerKeyDown(event: KeyboardEvent) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setFocusLast(event.key === 'ArrowUp');
      setOpen(true);
    }
  }

  function onMenuKeyDown(event: KeyboardEvent) {
    const entries = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const at = entries.findIndex((entry) => entry === document.activeElement);
    const moveTo = (index: number) => {
      event.preventDefault();
      entries[(index + entries.length) % entries.length]?.focus();
    };
    if (event.key === 'ArrowDown') moveTo(at + 1);
    else if (event.key === 'ArrowUp') moveTo(at - 1);
    else if (event.key === 'Home') moveTo(0);
    else if (event.key === 'End') moveTo(entries.length - 1);
    else if (event.key === 'Escape') {
      event.preventDefault();
      close(true);
    } else if (event.key === 'Tab') close(false);
  }

  return (
    <>
      <Button
        ref={triggerRef}
        type="button"
        variant="ghost"
        size="icon"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => {
          setFocusLast(false);
          if (open) close(false);
          else setOpen(true);
        }}
        onKeyDown={onTriggerKeyDown}
      >
        <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4 fill-current">
          <circle cx="8" cy="3" r="1.5" />
          <circle cx="8" cy="8" r="1.5" />
          <circle cx="8" cy="13" r="1.5" />
        </svg>
      </Button>
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKeyDown}
          style={{
            position: 'fixed',
            top: place?.top ?? 0,
            left: place?.left ?? 0,
            visibility: place ? 'visible' : 'hidden',
          }}
          className="z-20 flex min-w-32 flex-col rounded-lg border border-edge bg-surface p-1 shadow-md"
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              tabIndex={-1}
              onClick={() => {
                close(true);
                item.onSelect();
              }}
              className={`cursor-pointer rounded-md px-3 py-2 text-left text-sm hover:bg-sunken focus-visible:bg-sunken ${item.tone === 'danger' ? 'text-danger' : 'text-fg'}`}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
