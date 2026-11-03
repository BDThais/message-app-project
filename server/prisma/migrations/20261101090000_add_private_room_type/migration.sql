-- A third kind of room: an account's own room, "My Documents" in Zalo. Its owner is its only member and
-- it has no name or avatar (see "Private chat room" in backend.doc.md). The value is added on its own
-- because Postgres refuses to use an enum value in the transaction that added it: the next migration,
-- remove_private_chat_bot, uses it.
ALTER TYPE "ChatRoomType" ADD VALUE 'private';
