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

async function main() {
  const buckets = new Map<string, BucketKey>();
  let cursor: bigint | undefined;
  for (;;) {
    const rows = await prisma.projectSnapshot.findMany({
      take: 1000,
      ...(cursor === undefined ? {} : { skip: 1, cursor: { id: cursor } }),
      orderBy: { id: "asc" },
    });
    if (rows.length === 0) break;
    for (const row of rows) {
      const pairs = [
        ["hour", hourBucketStart(row.capturedAt)],
        ["day", dayBucketStart(row.capturedAt)],
      ] as const;
      for (const [granularity, bucketStart] of pairs) {
        const key = `${row.projectId}:${granularity}:${bucketStart.toISOString()}`;
        const existing = buckets.get(key);
        // Later capturedAt wins: the bucket holds the last observation.
        if (!existing || row.capturedAt >= existing.capturedAt) {
          buckets.set(key, {
            projectId: row.projectId,
            granularity,
            bucketStart,
            followers: row.followers,
            following: row.following,
            tweets: row.tweets,
            capturedAt: row.capturedAt,
          });
        }
      }
    }
    const last = rows[rows.length - 1];
    if (!last) break;
    cursor = last.id;
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
