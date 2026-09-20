import { purgeExpiredEmptyChatRooms } from '../services/ChatRoomCleanupServices';

// setInterval silently turns any delay above this (about 24.8 days) into 1 ms.
const MAX_TIMER_DELAY_MS = 2_147_483_647;

export interface EmptyChatRoomCleanupOptions {
  /** How long a room must have stayed empty before it is deleted. */
  retentionMs: number;
  /** How often to look for rooms that have been empty long enough. */
  intervalMs: number;
}

/**
 * Starts the recurring cleanup of empty chat rooms: one sweep right away (so a
 * server that restarts often still cleans up), then one every `intervalMs`.
 * Call it from server.ts only - not from app.ts - so tests that import the app
 * don't start a timer. Returns a function that stops the timer.
 *
 * The timer runs inside the API process, which is fine for a single server.
 * With several instances every one would sweep, which is harmless: deleting a
 * room that is already gone just matches zero rows.
 */
export function startEmptyChatRoomCleanup({
  retentionMs,
  intervalMs,
}: EmptyChatRoomCleanupOptions): () => void {
  // Fail loudly at startup: a NaN from a mistyped env var would otherwise turn
  // into a 1 ms timer or an invalid cutoff date on every sweep.
  if (!Number.isFinite(retentionMs) || retentionMs < 0) {
    throw new Error('Empty chat room retention must be a number of milliseconds >= 0');
  }
  if (!Number.isInteger(intervalMs) || intervalMs < 1 || intervalMs > MAX_TIMER_DELAY_MS) {
    throw new Error(
      `Empty chat room cleanup interval must be between 1 and ${MAX_TIMER_DELAY_MS} milliseconds`
    );
  }

  let sweeping = false;

  async function sweep() {
    // A slow sweep must not be joined by a second one when the next tick fires.
    if (sweeping) return;
    sweeping = true;
    try {
      const { deleted } = await purgeExpiredEmptyChatRooms(retentionMs);
      if (deleted > 0) {
        console.log(`Deleted ${deleted} empty chat room(s)`);
      }
    } catch (err) {
      // Never let a failed sweep become an unhandled rejection, which would
      // take the whole API process down. The next tick simply tries again.
      console.error('Empty chat room cleanup failed:', err);
    } finally {
      sweeping = false;
    }
  }

  void sweep();
  const timer = setInterval(sweep, intervalMs);
  // Don't let this timer alone keep the process alive.
  timer.unref();

  return () => clearInterval(timer);
}
