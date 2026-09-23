-- CreateTable
CREATE TABLE "telegram_bindings" (
    "chat_id" BIGINT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telegram_bindings_pkey" PRIMARY KEY ("chat_id")
);

-- CreateIndex
CREATE INDEX "telegram_bindings_user_id_idx" ON "telegram_bindings"("user_id");
