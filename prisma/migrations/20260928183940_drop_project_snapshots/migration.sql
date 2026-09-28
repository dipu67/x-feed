-- ⚠️ DO NOT apply this migration on any database before
-- scripts/backfill-rollups.ts has run successfully against it.
-- This DROP destroys legacy snapshot history. Production rollout order:
-- deploy code → selectively apply 20260928161652_project_metric_rollups →
-- run backfill-rollups.ts → only then apply this migration.
-- See docs/superpowers/plans/2026-09-28-metric-rollups.md Task 9.

/*
  Warnings:

  - You are about to drop the `project_snapshots` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "project_snapshots" DROP CONSTRAINT "project_snapshots_project_id_fkey";

-- DropTable
DROP TABLE "project_snapshots";
