import { ActionMenu } from '@/components/ui/ActionMenu';
import { Avatar } from '@/components/ui/Avatar';
import type { Member, Role } from '../types';

/**
 * The members, admins first. An admin gets a menu on every row but their own (leaving is its own section
 * of the panel), with the other role and the removal; `onChangeRole` and `onRemove` get a user id.
 */
export function MemberList({
  members,
  currentUserId,
  canManage,
  onChangeRole,
  onRemove,
}: {
  members: Member[];
  currentUserId: number;
  canManage: boolean;
  onChangeRole: (userId: number, role: Role) => void;
  onRemove: (userId: number) => void;
}) {
  return (
    <ul className="divide-y divide-line">
      {members.map(({ member, role }) => {
        const isMe = member.id === currentUserId;
        return (
          <li key={member.id} className="flex items-center gap-3 py-2">
            <Avatar size="sm" name={member.name} url={member.avatarUrl} />
            <span className="min-w-0 flex-1 truncate">
              {member.name}
              {isMe && <span className="text-muted"> (you)</span>}
            </span>
            {role === 'admin' && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs">Admin</span>}
            {canManage && !isMe && (
              <ActionMenu
                label={`Actions for ${member.name}`}
                items={[
                  role === 'admin'
                    ? { label: 'Make member', onSelect: () => onChangeRole(member.id, 'member') }
                    : { label: 'Make admin', onSelect: () => onChangeRole(member.id, 'admin') },
                  { label: 'Remove from group', tone: 'danger', onSelect: () => onRemove(member.id) },
                ]}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}
