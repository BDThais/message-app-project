import { useState, type SyntheticEvent } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button';
import { Form } from '@/components/ui/Form';
import { ListState } from '@/components/ui/ListState';
import { Notice } from '@/components/ui/Notice';
import { useAddMembers } from '../queries';
import type { Member, PublicUser } from '../types';
import { FriendPicker } from './FriendPicker';

/** The friends who are not in the group yet, to pick from (admins only: the caller decides who sees this). */
export function AddMembers({
  chatId,
  members,
  friends,
}: {
  chatId: number;
  members: Member[];
  friends: UseQueryResult<PublicUser[]>;
}) {
  const add = useAddMembers(chatId);
  const [selected, setSelected] = useState<number[]>([]);
  const memberIds = new Set(members.map(({ member }) => member.id));

  function handleSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    add.mutate(selected, { onSuccess: () => setSelected([]) });
  }

  return (
    <ListState query={friends} empty="You have no friends to add yet.">
      {(all) => {
        const candidates = all.filter(({ id }) => !memberIds.has(id));
        if (candidates.length === 0) return <p className="text-sm text-muted">All your friends are in this group.</p>;
        return (
          <Form onSubmit={handleSubmit}>
            <FriendPicker legend="Add friends" friends={candidates} selected={selected} onChange={setSelected} />
            {add.error && (
              <Notice tone="error" role="alert">
                {add.error.message}
              </Notice>
            )}
            <Button type="submit" disabled={selected.length === 0 || add.isPending}>
              {add.isPending ? 'Adding…' : 'Add to group'}
            </Button>
          </Form>
        );
      }}
    </ListState>
  );
}
