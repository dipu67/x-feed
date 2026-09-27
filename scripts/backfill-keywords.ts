import "dotenv/config";
import { Prisma } from "../src/generated/prisma/client.js";
import { prisma } from "../src/db/prisma.js";
import { compileKeywordMatcher } from "../src/lib/keywords.js";

const BATCH_SIZE = 500;

async function main() {
  const keywords = await prisma.keyword.findMany({ where: { enabled: true } });
  if (keywords.length === 0) {
    console.log("[backfill] no enabled keywords; nothing to classify");
    return;
  }
  const matcher = compileKeywordMatcher(keywords);

  // DB NULL = never classified (pre-feature rows). JSON null = already
  // classified empty, so re-running never rescans.
  let cursor: string | undefined;
  let scanned = 0;
  let matchedCount = 0;
  for (;;) {
    // Keyset pagination on id. Do NOT use cursor + skip: 1 — Prisma 7.10
    // compiles that as WHERE (...) ... OFFSET 1, and OFFSET applies after
    // WHERE, so when the cursor row was just updated out of the NULL set
    // the OFFSET eats a still-NULL successor per batch boundary.
    const rows = await prisma.feedItem.findMany({
      take: BATCH_SIZE,
      where: {
        matchedKeywords: { equals: Prisma.DbNull },
        ...(cursor === undefined ? {} : { id: { gt: cursor } }),
      },
      orderBy: { id: "asc" },
      select: { id: true, text: true },
    });
    if (rows.length === 0) break;

    for (const row of rows) {
      const matched = matcher.match(row.text);
      await prisma.feedItem.update({
        where: { id: row.id },
        data: {
          matchedKeywords:
            matched.length > 0
              ? (matched as unknown as Prisma.InputJsonValue)
              : Prisma.JsonNull,
          matchedCount: matched.length,
        },
      });
      if (matched.length > 0) matchedCount++;
    }
    scanned += rows.length;
    const last = rows[rows.length - 1];
    if (!last) break;
    cursor = last.id;
    console.log(
      `[backfill] ${scanned} scanned, ${matchedCount} matched so far`,
    );
  }
  console.log(`[backfill] done: ${scanned} scanned, ${matchedCount} matched`);
}

main()
  .catch((error) => {
    console.error("[backfill] failed:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
