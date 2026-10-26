import type { ButtonHTMLAttributes } from 'react';

const variants = {
  primary: 'bg-accent text-on-accent enabled:hover:bg-accent-strong',
  secondary: 'border border-edge bg-surface text-fg enabled:hover:bg-sunken',
  ghost: 'text-muted enabled:hover:bg-sunken enabled:hover:text-fg',
  danger: 'border border-danger/30 bg-danger-soft text-danger enabled:hover:border-danger/60',
} as const;

// The text size is part of the size, not of the shared classes: two utilities for the same property
// (`text-sm` and `text-xs`) are won by whichever the stylesheet lists last, not by the one written last.
const sizes = {
  md: 'h-11 px-5 text-sm',
  sm: 'h-9 px-3.5 text-sm',
  xs: 'h-7 px-2.5 text-xs',
} as const;

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
  fullWidth?: boolean;
}

/**
 * There is no `className` prop on purpose: a button looks the same everywhere, and spacing around it
 * is the parent's job. A look that is missing is added here, as a variant.
 */
export function Button({ variant = 'primary', size = 'md', fullWidth = false, ...buttonProps }: ButtonProps) {
  const className = [
    'inline-flex shrink-0 cursor-pointer items-center justify-center whitespace-nowrap rounded-lg font-medium transition-[background-color]',
    'disabled:cursor-default disabled:opacity-60',
    variants[variant],
    sizes[size],
    fullWidth && 'w-full',
  ]
    .filter(Boolean)
    .join(' ');

  return <button className={className} {...buttonProps} />;
}
