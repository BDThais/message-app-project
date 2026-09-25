/**
 * Largest value a signed 32-bit integer can hold (2^31 - 1). Two unrelated
 * limits in this codebase happen to land on exactly this number, so both
 * import it instead of redeclaring the same literal:
 * - the largest value a Postgres INTEGER column can store (User.id,
 *   ChatRoom.id) - see chatRoom.validator.ts;
 * - the largest delay Node's setInterval/setTimeout accept before silently
 *   wrapping it down to 1 ms - see chatRoomCleanup.job.ts.
 */
export const MAX_INT32 = 2_147_483_647;
