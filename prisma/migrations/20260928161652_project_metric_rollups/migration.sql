-- CreateTable
CREATE TABLE "project_metric_rollups" (
    "project_id" TEXT NOT NULL,
    "granularity" TEXT NOT NULL,
    "bucket_start" TIMESTAMPTZ NOT NULL,
    "followers" INTEGER NOT NULL,
    "following" INTEGER NOT NULL,
    "tweets" INTEGER NOT NULL
);

-- CreateIndex
CREATE INDEX "project_metric_rollups_granularity_bucket_start_idx" ON "project_metric_rollups"("granularity", "bucket_start");

-- CreateIndex
CREATE UNIQUE INDEX "project_metric_rollups_project_id_granularity_bucket_start_key" ON "project_metric_rollups"("project_id", "granularity", "bucket_start");

-- AddForeignKey
ALTER TABLE "project_metric_rollups" ADD CONSTRAINT "project_metric_rollups_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("userId") ON DELETE CASCADE ON UPDATE CASCADE;
