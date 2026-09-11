-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "is_blue_verified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "last_seen_at" TIMESTAMPTZ,
ADD COLUMN     "location" TEXT,
ADD COLUMN     "missed_checks" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'active',
ADD COLUMN     "status_changed_at" TIMESTAMPTZ,
ADD COLUMN     "status_reason" TEXT,
ADD COLUMN     "twitter_bio" TEXT;

-- CreateTable
CREATE TABLE "project_snapshots" (
    "id" BIGSERIAL NOT NULL,
    "project_id" TEXT NOT NULL,
    "followers" INTEGER NOT NULL,
    "following" INTEGER NOT NULL,
    "tweets" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "captured_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_changes" (
    "id" BIGSERIAL NOT NULL,
    "project_id" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "old_value" TEXT,
    "new_value" TEXT,
    "changed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "project_snapshots_project_id_captured_at_idx" ON "project_snapshots"("project_id", "captured_at" DESC);

-- CreateIndex
CREATE INDEX "project_snapshots_captured_at_idx" ON "project_snapshots"("captured_at" DESC);

-- CreateIndex
CREATE INDEX "project_changes_project_id_changed_at_idx" ON "project_changes"("project_id", "changed_at" DESC);

-- CreateIndex
CREATE INDEX "project_changes_changed_at_idx" ON "project_changes"("changed_at" DESC);

-- CreateIndex
CREATE INDEX "project_changes_field_idx" ON "project_changes"("field");

-- CreateIndex
CREATE INDEX "projects_status_idx" ON "projects"("status");

-- AddForeignKey
ALTER TABLE "project_snapshots" ADD CONSTRAINT "project_snapshots_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_changes" ADD CONSTRAINT "project_changes_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("userId") ON DELETE CASCADE ON UPDATE CASCADE;
