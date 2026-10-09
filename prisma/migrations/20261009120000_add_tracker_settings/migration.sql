-- CreateTable
CREATE TABLE "tracker_settings" (
    "id" TEXT NOT NULL,
    "growth_interval_ms" INTEGER NOT NULL DEFAULT 3600000,
    "growth_recorded_at" TIMESTAMPTZ,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "tracker_settings_pkey" PRIMARY KEY ("id")
);
