-- AlterTable
ALTER TABLE "chat_rooms" ADD COLUMN     "emptied_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "chat_rooms_emptied_at_idx" ON "chat_rooms"("emptied_at");
