-- AlterTable
ALTER TABLE "x_auth_token" ADD COLUMN     "user_id" TEXT;

-- CreateIndex
CREATE INDEX "x_auth_token_user_id_idx" ON "x_auth_token"("user_id");
