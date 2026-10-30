-- The bot of the private chat rooms (users.is_bot, see add_private_chat_room) is a member of every
-- account's private room. Deleting its row would cascade to all of those memberships at once and leave
-- every private room with one member and nobody to be the other. No code path deletes it, so this
-- refuses a delete that gets to the database some other way (a hand-written DELETE, a cleanup script).
-- Like the lower-case CHECK on the email, a trigger is outside what the Prisma schema can express and
-- does not show up as drift. TRUNCATE does not fire row triggers: this guards a mistake, not an
-- administrator. The migrations that created the bot and its rooms do not delete it, so none is affected.
CREATE FUNCTION "refuse_bot_deletion"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'the private chat room bot (user %) cannot be deleted', OLD."id"
    USING ERRCODE = 'restrict_violation';
END
$$;

CREATE TRIGGER "users_bot_not_deletable"
BEFORE DELETE ON "users"
FOR EACH ROW
WHEN (OLD."is_bot")
EXECUTE FUNCTION "refuse_bot_deletion"();
