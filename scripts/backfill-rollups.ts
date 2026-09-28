import "dotenv/config";
import { prisma } from "../src/db/prisma.js";
import { dayBucketStart, hourBucketStart } from "../src/lib/bucket.js";

type BucketKey = {
  projectId: string;
  granularity: string;
  bucketStart: Date;
  followers: number;
  following: number;
  tweets: number;
  capturedAt: Date;
};

type LegacySnapshotRow = {
  id: bigint;
  project_id: string;
  followers: number;
  following: number;
  tweets: number;
  captured_at: Date;
};

const PAGE_SIZE = 1000;

async function main() {
  const buckets = new Map<string, BucketKey>();
  let cursor = BigInt(0);
  // Raw SQL on purpose: the ProjectSnapshot model is gone from the generated
  // client, but the backfill must run from deployed code while the legacy
  // table still exists (deploy -> backfill -> migrate deploy drops it).
  for (;;) {
    const rows = await prisma.$queryRaw<LegacySnapshotRow[]>`
      SELECT id, project_id, followers, following, tweets, captured_at
      FROM project_snapshots
      WHERE id > ${cursor}
      ORDER BY id ASC
      LIMIT ${PAGE_SIZE}
    `;
    if (rows.length === 0) break;
    for (const row of rows) {
      const id = BigInt(row.id);
      const capturedAt = new Date(row.captured_at);
      const pairs = [
        ["hour", hourBucketStart(capturedAt)],
        ["day", dayBucketStart(capturedAt)],
      ] as const;
      for (const [granularity, bucketStart] of pairs) {
        const key = `${row.project_id}:${granularity}:${bucketStart.toISOString()}`;
        const existing = buckets.get(key);
        // Later capturedAt wins: the bucket holds the last observation.
        if (!existing || capturedAt >= existing.capturedAt) {
          buckets.set(key, {
            projectId: row.project_id,
            granularity,
            bucketStart,
            followers: row.followers,
            following: row.following,
            tweets: row.tweets,
            capturedAt,
          });
        }
      }
      cursor = id;
    }
    if (rows.length < PAGE_SIZE) break;
    console.log(`[backfill-rollups] scanned ${rows.length} rows…`);
  }

  let created = 0;
  const values = [...buckets.values()];
  for (let i = 0; i < values.length; i += 500) {
    const chunk = values.slice(i, i + 500).map((b) => ({
      projectId: b.projectId,
      granularity: b.granularity,
      bucketStart: b.bucketStart,
      followers: b.followers,
      following: b.following,
      tweets: b.tweets,
    }));
    const res = await prisma.projectMetricRollup.createMany({
      data: chunk,
      skipDuplicates: true,
    });
    created += res.count;
  }
  console.log(
    `[backfill-rollups] buckets=${values.length} created=${created}`,
  );
}

main()
  .catch((error) => {
    console.error("[backfill-rollups] failed:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
