import { Avatar } from '@/components/ui/Avatar';
import type { PublicUser } from '../types';

/** Friends with a checkbox each, for choosing who goes into a group. `selected` is a list of user ids. */
export function FriendPicker({
  legend,
  friends,
  selected,
  onChange,
}: {
  legend: string;
  friends: PublicUser[];
  selected: number[];
  onChange: (selected: number[]) => void;
}) {
  const toggle = (id: number) =>
    onChange(selected.includes(id) ? selected.filter((each) => each !== id) : [...selected, id]);

  return (
    <fieldset className="grid gap-1">
      <legend className="mb-1 text-sm font-medium">{legend}</legend>
      <ul className="max-h-60 overflow-y-auto rounded-lg border border-line">
        {friends.map((friend) => (
          <li key={friend.id}>
            <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-sunken">
              <input
                type="checkbox"
                checked={selected.includes(friend.id)}
                onChange={() => toggle(friend.id)}
                className="size-4 accent-accent"
              />
              <Avatar size="sm" name={friend.name} url={friend.avatarUrl} />
              <span className="min-w-0 truncate">{friend.name}</span>
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}
