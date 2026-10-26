-- Every account has a private chat room, like "My Documents" in Zalo: a direct room whose other member
-- is one hidden bot account that never writes. The bot is a user row with is_bot = true; the friend
-- lookups, login, password reset and the member list skip such rows (see "Private chat room" in
-- backend.doc.md). New accounts get their room when they are created (createUser); this migration
-- creates the bot and gives the accounts that already exist theirs.
ALTER TABLE "users" ADD COLUMN "is_bot" BOOLEAN NOT NULL DEFAULT false;

-- The email cannot receive mail (the .invalid top-level domain is reserved for that) and the tel is not
-- a phone number, so no signup collides with either. The password hash is a real argon2 hash of a random
-- secret that was thrown away: verifying any password against it fails instead of raising an error.
INSERT INTO "users" ("name", "email", "tel", "password_hash", "is_bot")
VALUES ('My Documents', 'my-documents@bot.invalid', 'bot:my-documents', '$argon2id$v=19$m=65536,p=4,t=3$7WYPhtA5EzhMKUCmN70EvA$jpbgtP/pgnDl/qBcffhvOUYPUyrjbTo5ttbeS+G0CVM', true);

-- backfill: start
-- One room for each account that has none, in id order. Safe to run again: an account that already
-- shares a room with the bot is skipped (test/chatrooms/privateRoom.backfill.test.ts runs this block).
DO $$
DECLARE
  bot_id INTEGER;
  account RECORD;
  new_room_id INTEGER;
BEGIN
  SELECT "id" INTO STRICT bot_id FROM "users" WHERE "email" = 'my-documents@bot.invalid';

  FOR account IN
    SELECT u."id"
    FROM "users" u
    WHERE NOT u."is_bot"
      AND NOT EXISTS (
        SELECT 1
        FROM "chat_members" mine
        JOIN "chat_members" theirs ON theirs."chat_id" = mine."chat_id"
        WHERE mine."member_id" = u."id" AND theirs."member_id" = bot_id
      )
    ORDER BY u."id"
  LOOP
    INSERT INTO "chat_rooms" ("type") VALUES ('direct') RETURNING "id" INTO new_room_id;
    INSERT INTO "chat_members" ("chat_id", "member_id", "role")
    VALUES (new_room_id, account."id", 'admin'), (new_room_id, bot_id, 'admin');
  END LOOP;
END
$$;
-- backfill: end
