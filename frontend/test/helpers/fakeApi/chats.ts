import { json } from './responses';
import type { Body, FakeServer } from './state';

/**
 * The chat endpoints. For now only a stand-in for any protected endpoint: 401 when there is no
 * session. The real ones (rooms, members, messages) go here, with their data in the shared state.
 */
export function chatEndpoints(request: string, _body: Body, state: FakeServer): Response | undefined {
  switch (request) {
    case 'GET /api/chat':
      return state.session ? json({ chatRooms: [] }) : json({ error: 'Unauthorized Access' }, 401);

    default:
      return undefined;
  }
}
