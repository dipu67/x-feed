/*
  Warnings:

  - You are about to drop the `project_snapshots` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "project_snapshots" DROP CONSTRAINT "project_snapshots_project_id_fkey";

-- DropTable
DROP TABLE "project_snapshots";
