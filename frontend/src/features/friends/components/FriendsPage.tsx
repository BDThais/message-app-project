import { FindFriend } from './FindFriend';
import { FriendList } from './FriendList';
import { IncomingRequests } from './IncomingRequests';
import { OutgoingRequests } from './OutgoingRequests';

/** The content of `/friends`: finding people, the requests in both directions, and the friends. */
export function FriendsPage() {
  return (
    <>
      <h1>Friends</h1>
      <FindFriend />
      <IncomingRequests />
      <OutgoingRequests />
      <FriendList />
    </>
  );
}
