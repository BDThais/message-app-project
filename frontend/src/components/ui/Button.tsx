import type { ButtonHTMLAttributes } from 'react';

const variants = {
  primary: 'bg-accent text-on-accent enabled:hover:bg-accent-strong',
  secondary: 'border border-edge bg-surface text-fg enabled:hover:bg-sunken',
} as const;

const sizes = {
  md: 'h-11 px-5',
  sm: 'h-9 px-3.5',
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
    'inline-flex shrink-0 cursor-pointer items-center justify-center whitespace-nowrap rounded-lg text-sm font-medium transition-[background-color]',
    'disabled:cursor-default disabled:opacity-60',
    variants[variant],
    sizes[size],
    fullWidth && 'w-full',
  ]
    .filter(Boolean)
    .join(' ');

  return <button className={className} {...buttonProps} />;
}
