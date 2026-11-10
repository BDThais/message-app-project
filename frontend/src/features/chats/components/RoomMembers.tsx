import type { UseQueryResult } from '@tanstack/react-query';
import { ListState } from '@/components/ui/ListState';
import { Notice } from '@/components/ui/Notice';
import { Section } from '@/components/ui/Section';
import { useMe } from '@/features/account/queries';
import { useChangeMemberRole, useChatRooms, useMembers, useRemoveMember } from '../queries';
import type { PublicUser } from '../types';
import { AddMembers } from './AddMembers';
import { LeaveOrDelete } from './LeaveOrDelete';
import { MemberList } from './MemberList';
import { RoomSettingsForm } from './RoomSettingsForm';

/**
 * What the Members button of a group room opens, in place of the messages: the members with their roles
 * and, by what the person's own role is, the group's name and avatar, who is in it, adding friends, leaving
 * and deleting. What the person may do is decided by the server (see the permission model in api.doc.md);
 * this only leaves out what it would refuse. The friends come from the page that uses this, because the
 * friends feature imports this one and not the other way round.
 */
export function RoomMembers({ chatId, friends }: { chatId: number; friends: UseQueryResult<PublicUser[]> }) {
  const { data: me } = useMe();
  const rooms = useChatRooms();
  const members = useMembers(chatId);
  const removeMember = useRemoveMember(chatId);
  const changeRole = useChangeMemberRole(chatId);

  const room = rooms.data?.find(({ id }) => id === chatId);
  const isGroup = room?.type === 'group';
  const isAdmin = isGroup && members.data?.find(({ member }) => member.id === me?.id)?.role === 'admin';
  const actionError = removeMember.error ?? changeRole.error;

  // One refusal at a time: the one of the last action, and a row that went takes no error with it.
  function resetActions() {
    removeMember.reset();
    changeRole.reset();
  }

  if (!me) return null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto bg-canvas p-4">
      {isAdmin && room && (
        <Section title="Group">
          <RoomSettingsForm room={room} />
        </Section>
      )}
      <Section title="Members">
        {actionError && (
          <Notice tone="error" role="alert">
            {actionError.message}
          </Notice>
        )}
        <ListState query={members} empty="Nobody is in this room.">
          {(items) => (
            <MemberList
              members={items}
              currentUserId={me.id}
              canManage={isAdmin}
              onChangeRole={(userId, role) => {
                resetActions();
                changeRole.mutate({ userId, role });
              }}
              onRemove={(userId) => {
                resetActions();
                removeMember.mutate(userId);
              }}
            />
          )}
        </ListState>
      </Section>
      {isAdmin && members.data && (
        <Section title="Add people">
          <AddMembers chatId={chatId} members={members.data} friends={friends} />
        </Section>
      )}
      {isGroup && (
        <Section title="Leave or delete">
          <LeaveOrDelete chatId={chatId} userId={me.id} isAdmin={isAdmin} />
        </Section>
      )}
    </div>
  );
}
