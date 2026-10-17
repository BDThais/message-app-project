-- Addresses are stored lower-cased (normalizeEmail in src/lib/emailAddress.ts), so that "John@x.com"
-- and "john@x.com" are one account: the unique index on "email" then also stops a second spelling.
-- The Prisma schema cannot express a CHECK constraint, so it exists only here; Prisma does not compare
-- constraints of this kind with the schema, so it does not show up as drift.
-- It is added without changing any row: it fails if a stored address still has capitals (lower-case
-- those first; if two accounts differ only in case, they have to be merged or one renamed by hand).
ALTER TABLE "users" ADD CONSTRAINT "users_email_lowercase_check" CHECK ("email" = lower("email"));
