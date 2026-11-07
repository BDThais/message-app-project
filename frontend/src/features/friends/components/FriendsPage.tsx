import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Notice } from '@/components/ui/Notice';
import { FindFriend } from './FindFriend';
import { FriendList } from './FriendList';
import { IncomingRequests } from './IncomingRequests';
import { OutgoingRequests } from './OutgoingRequests';

/** The content of `/friends`: finding people, the requests in both directions, and the friends. */
export function FriendsPage() {
  const [news, setNews] = useState<string | null>(null);

  return (
    <>
      <h1>Friends</h1>
      {/* A row that the refreshed list no longer has takes its own error with it, so the page says why it went. The region is always in the page: a screen reader only announces text put into one that was already there. */}
      <div role="status" className="empty:hidden">
        {news && (
          <Notice tone="info">
            <div className="flex items-center justify-between gap-3">
              <span>{news}</span>
              <Button type="button" variant="ghost" size="xs" onClick={() => setNews(null)}>
                Dismiss
              </Button>
            </div>
          </Notice>
        )}
      </div>
      <FindFriend />
      <IncomingRequests onNews={setNews} />
      <OutgoingRequests onNews={setNews} />
      <FriendList onNews={setNews} />
    </>
  );
}
