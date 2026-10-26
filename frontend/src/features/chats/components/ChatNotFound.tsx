import { Link } from '@tanstack/react-router';

/** For a path that is not a room id, and for a room the API answers 404 for: it is not there, or the person is not in it. */
export function ChatNotFound() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      <h1>Chat not found</h1>
      <p className="text-muted">This chat does not exist, or you are not a member of it.</p>
      <p>
        <Link to="/chat">Back to your chats</Link>
      </p>
    </div>
  );
}
