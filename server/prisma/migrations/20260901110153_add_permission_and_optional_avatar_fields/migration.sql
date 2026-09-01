-- CreateEnum
CREATE TYPE "ChatMemberRole" AS ENUM ('admin', 'member');

-- AlterTable
ALTER TABLE "chat_members" ADD COLUMN     "role" "ChatMemberRole" NOT NULL DEFAULT 'member';

-- AlterTable
ALTER TABLE "chat_rooms" ADD COLUMN     "avatar_url" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "avatar_url" TEXT;
