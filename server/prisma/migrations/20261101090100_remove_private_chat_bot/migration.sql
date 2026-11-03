-- The private chat room stops being a direct room with a hidden bot (add_private_chat_room,
-- protect_private_chat_bot) and becomes a room of its own type with its owner as the only member
-- (add_private_room_type). The bot was a row in `users` that every lookup of a user had to remember to
-- skip; a room type needs no such care.

-- Every room the bot is in becomes a private room. The bot is in no other room, since nobody could add it.
UPDATE "chat_rooms"
SET "type" = 'private'
WHERE "id" IN (
  SELECT cm."chat_id"
  FROM "chat_members" cm
  JOIN "users" u ON u."id" = cm."member_id"
  WHERE u."is_bot"
);

-- The trigger that refused to delete the bot has to go before the bot can.
DROP TRIGGER "users_bot_not_deletable" ON "users";
DROP FUNCTION "refuse_bot_deletion"();

-- Deleting the bot deletes its memberships too (the foreign key cascades), which leaves each private
-- room with its owner. It has no sessions, friends or messages.
DELETE FROM "users" WHERE "is_bot";

ALTER TABLE "users" DROP COLUMN "is_bot";
