import { useState } from 'react';

const sizes = {
  sm: 'size-8 text-xs',
  md: 'size-10 text-sm',
} as const;

function initialsOf(name: string): string {
  const letters = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => Array.from(word)[0] ?? '');
  return letters.join('').toUpperCase() || '?';
}

/**
 * The picture at `url`, or the initials of `name` when there is none or it does not load: an avatar
 * is a URL the user pasted, so it can be dead. It is decoration, because the name is always next to it.
 */
export function Avatar({ name, url, size = 'md' }: { name: string; url: string | null; size?: keyof typeof sizes }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const box = `inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full ${sizes[size]}`;

  if (url !== null && url !== failedUrl) {
    // no-referrer: the picture sits on somebody else's server, which has no business knowing which page showed it.
    return (
      <img
        src={url}
        alt=""
        referrerPolicy="no-referrer"
        onError={() => setFailedUrl(url)}
        className={`${box} object-cover`}
      />
    );
  }

  return (
    <span aria-hidden="true" className={`${box} bg-accent-soft font-semibold text-fg`}>
      {initialsOf(name)}
    </span>
  );
}
