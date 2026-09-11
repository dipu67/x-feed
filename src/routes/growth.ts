import { Router } from "express";
import { prisma } from "../db/prisma.js";

export const growthRouter = Router();

export const RANGE_KEYS = ["1h", "12h", "24h", "7d", "all"] as const;
export type RangeKey = (typeof RANGE_KEYS)[number];

function parseRange(raw: unknown): RangeKey {
  if (typeof raw !== "string") return "24h";
  return (RANGE_KEYS as readonly string[]).includes(raw)
    ? (raw as RangeKey)
    : "24h";
}

function rangeToSince(range: RangeKey): Date | null {
  const now = Date.now();
  switch (range) {
    case "1h":
      return new Date(now - 60 * 60 * 1000);
    case "12h":
      return new Date(now - 12 * 60 * 60 * 1000);
    case "24h":
      return new Date(now - 24 * 60 * 60 * 1000);
    case "7d":
      return new Date(now - 7 * 24 * 60 * 60 * 1000);
    case "all":
      return null;
  }
}

const METRIC_FIELDS = ["followers", "following", "tweets"] as const;
type MetricField = (typeof METRIC_FIELDS)[number];

function safeInt(value: string | null): number {
  if (value === null || value === "") return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Sum up the value-deltas of every in-window metric-change row for one
 * user. This is the source of truth for the per-window follower / following /
 * tweet deltas — it doesn't depend on having a pre-window baseline snapshot
 * (the poller only writes a snapshot when a value actually moves, so a
 * 1h window can legitimately have no baseline). The change log is
 * append-only and indexed on `[projectId, changedAt DESC]`, so this is one
 * query per user.
 */
function sumMetricChanges(
  rows: Array<{ field: string; oldValue: string | null; newValue: string | null }>,
): Record<MetricField, number> {
  const result: Record<MetricField, number> = {
    followers: 0,
    following: 0,
    tweets: 0,
  };
  for (const row of rows) {
    if (!METRIC_FIELDS.includes(row.field as MetricField)) continue;
    const field = row.field as MetricField;
    const next = safeInt(row.newValue);
    const prev = safeInt(row.oldValue);
    result[field] += next - prev;
  }
  return result;
}

growthRouter.get("/", async (req, res) => {
  try {
    const range = parseRange(req.query.range);
    const since = rangeToSince(range);

    const filterUserId =
      typeof req.query.userId === "string" ? req.query.userId : undefined;

    const projects = await prisma.project.findMany({
      where: filterUserId ? { userId: filterUserId } : {},
      orderBy: { userId: "asc" },
    });
    if (projects.length === 0) {
      res.json({
        range,
        since: since?.toISOString(),
        generatedAt: new Date().toISOString(),
        count: 0,
        users: [],
      });
      return;
    }

    // Single query: every ProjectChange inside the window, bucketed per
    // user. Cuts N round-trips to 1.
    const windowChanges = since
      ? await prisma.projectChange.findMany({
          where: {
            changedAt: { gte: since },
            projectId: { in: projects.map((p) => p.userId) },
          },
          orderBy: { changedAt: "asc" },
        })
      : await prisma.projectChange.findMany({
          where: { projectId: { in: projects.map((p) => p.userId) } },
          orderBy: { changedAt: "asc" },
        });
    const changesByUser = new Map<string, typeof windowChanges>();
    for (const c of windowChanges) {
      const arr = changesByUser.get(c.projectId) ?? [];
      arr.push(c);
      changesByUser.set(c.projectId, arr);
    }

    // Tweets-in-window per user (independent counter — every FeedItem the
    // poller detected inside the window).
    const tweetsInWindow = since
      ? await prisma.feedItem.groupBy({
          by: ["projectId"],
          where: {
            detectedAt: { gte: since },
            projectId: { in: projects.map((p) => p.userId) },
          },
          _count: { _all: true },
        })
      : await prisma.feedItem.groupBy({
          by: ["projectId"],
          where: { projectId: { in: projects.map((p) => p.userId) } },
          _count: { _all: true },
        });
    const tweetsInWindowByUser = new Map(
      tweetsInWindow.map((row) => [row.projectId, row._count._all]),
    );

    // Newest tweet per user (independent of window — always shown).
    const latestItems = await prisma.feedItem.findMany({
      where: {
        projectId: { in: projects.map((p) => p.userId) },
      },
      orderBy: { detectedAt: "desc" },
      take: projects.length,
    });
    const latestByUser = new Map<string, (typeof latestItems)[number]>();
    for (const item of latestItems) {
      if (!latestByUser.has(item.projectId)) {
        latestByUser.set(item.projectId, item);
      }
    }

    const users = projects.map((project) => {
      const userChanges = changesByUser.get(project.userId) ?? [];
      const deltas = sumMetricChanges(
        userChanges.map((c) => ({
          field: c.field,
          oldValue: c.oldValue,
          newValue: c.newValue,
        })),
      );

      const formattedChanges = userChanges.map((c) => ({
        field: c.field,
        oldValue: c.oldValue,
        newValue: c.newValue,
        changedAt: c.changedAt.toISOString(),
      }));

      const latestItem = latestByUser.get(project.userId);
      const latestTweet = latestItem
        ? {
            id: latestItem.id,
            text: latestItem.text,
            tweetUrl: latestItem.tweetUrl,
            postedAt: latestItem.postedAt.toISOString(),
            likes: latestItem.likes,
            reposts: latestItem.reposts,
            replies: latestItem.replies,
          }
        : null;

      return {
        userId: project.userId,
        username: project.username,
        twitterName: project.twitterName,
        twitterBio: project.twitterBio,
        location: project.location,
        isBlueVerified: project.isBlueVerified,
        followers: project.followers,
        following: project.following,
        tweets: project.tweets,
        description: project.description,
        website: project.website,
        github: project.github,
        chain: project.chain,
        tokenAddress: project.tokenAddress,
        profileImageUrl: project.profileImageUrl,
        status: project.status,
        statusReason: project.statusReason,
        statusChangedAt: project.statusChangedAt?.toISOString() ?? null,
        lastSeenAt: project.lastSeenAt?.toISOString() ?? null,
        missedChecks: project.missedChecks,
        lastFetchedAt: project.lastFetchedAt?.toISOString() ?? null,
        followersDelta: deltas.followers,
        followingDelta: deltas.following,
        tweetsDelta: deltas.tweets,
        changes: formattedChanges,
        tweetsInWindow: tweetsInWindowByUser.get(project.userId) ?? 0,
        latestTweet,
      };
    });

    const sortBy =
      typeof req.query.sortBy === "string" ? req.query.sortBy : "userId";
    const sortOrder =
      typeof req.query.sortOrder === "string" && req.query.sortOrder === "asc"
        ? "asc"
        : "desc";

    if (sortBy === "growth") {
      // Sum the three deltas and rank by absolute growth. Secondary sort
      // by userId keeps ties stable.
      const score = (u: (typeof users)[number]) =>
        u.followersDelta + u.followingDelta + u.tweetsDelta;
      const dir = sortOrder === "asc" ? 1 : -1;
      users.sort((a, b) => {
        const diff = dir * (score(b) - score(a));
        if (diff !== 0) return diff;
        return sortOrder === "asc"
          ? a.userId.localeCompare(b.userId)
          : b.userId.localeCompare(a.userId);
      });
    } else {
      // Default: sort by numeric userId ASC (the user's request).
      const dir = sortOrder === "asc" ? 1 : -1;
      users.sort((a, b) => dir * a.userId.localeCompare(b.userId));
    }

    res.json({
      range,
      since: since?.toISOString(),
      generatedAt: new Date().toISOString(),
      count: users.length,
      users,
    });
  } catch (error) {
    console.error("[growth]", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Internal server error",
    });
  }
});
