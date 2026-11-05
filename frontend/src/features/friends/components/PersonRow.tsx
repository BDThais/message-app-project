import type { ReactNode } from 'react';
import { Avatar } from '@/components/ui/Avatar';
import type { PublicUser } from '../types';

/** One person in a list: the picture, the name, and the actions (`children`) at the end. `below` is for a question that needs a line of its own. */
export function PersonRow({
  person,
  error,
  below,
  children,
}: {
  person: PublicUser;
  /** The server's text for an action that was refused. */
  error?: string | undefined;
  below?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <li className="flex flex-col gap-2 py-2.5">
      <div className="flex items-center gap-3">
        <Avatar name={person.name} url={person.avatarUrl} />
        <span className="min-w-0 flex-1 truncate font-medium">{person.name}</span>
        <div className="flex shrink-0 items-center gap-2">{children}</div>
      </div>
      {below}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </li>
  );
}
