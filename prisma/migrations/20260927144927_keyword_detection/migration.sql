-- CreateTable
CREATE TABLE "keywords" (
    "id" BIGSERIAL NOT NULL,
    "phrase" TEXT NOT NULL,
    "tag" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "keywords_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "keywords_phrase_key" ON "keywords"("phrase");

-- AlterTable
ALTER TABLE "feed_items" ADD COLUMN     "matched_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "matched_keywords" JSONB;

-- CreateIndex
CREATE INDEX "feed_items_matched_count_detected_at_idx" ON "feed_items"("matched_count", "detected_at" DESC);
