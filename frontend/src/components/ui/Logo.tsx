export function Logo() {
  return (
    <span className="inline-flex shrink-0 items-center gap-2.5 whitespace-nowrap text-lg font-semibold tracking-tight">
      <svg viewBox="0 0 32 32" aria-hidden="true" className="size-8 shrink-0">
        <rect width="32" height="32" rx="9" className="fill-accent" />
        <path
          d="M16 7c-5.5 0-9.5 3.7-9.5 8.4 0 2.6 1.2 4.8 3.2 6.3v3.6c0 .6.6.9 1.1.6l3-1.9c.7.1 1.4.2 2.2.2 5.5 0 9.5-3.7 9.5-8.4S21.5 7 16 7z"
          fill="#fff"
        />
      </svg>
      Message App
    </span>
  );
}
