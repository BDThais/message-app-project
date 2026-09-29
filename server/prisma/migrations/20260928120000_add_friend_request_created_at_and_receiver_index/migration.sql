-- AlterTable
ALTER TABLE "pending_friend_requests" ADD COLUMN     "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "pending_friend_requests_receiver_id_idx" ON "pending_friend_requests"("receiver_id");
