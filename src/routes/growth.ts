import { Router } from "express";
import { prisma } from "../db/prisma.js";
import { requireUser } from "../auth/middleware.js";
import { Prisma } from "../generated/prisma/client.js";
import type { TrendRange } from "../lib/bucket.js";
import { trendWindow, parseTrendRange } from "../lib/bucket.js";
import {
  getGrowthSchedule,
  GrowthIntervalError,
  parseGrowthInterval,
  serializeGrowthSettings,
  setGrowthInterval,
} from "../services/growth-schedule.js";

export const growthRouter = Router();

growthRouter.use(requireUser);

growthRouter.get("/settings", async (_req, res) => {
  try {
    const schedule = await getGrowthSchedule();
    res.json(serializeGrowthSettings(schedule));
  } catch (error) {
    console.error("[growth:settings]", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Internal server error",
    });
  }
});

growthRouter.patch("/settings", async (req, res) => {
  try {
    const ms = parseGrowthInterval(req.body?.growthIntervalMs);
    const saved = await setGrowthInterval(ms);
    res.json(serializeGrowthSettings(saved));
  } catch (error) {
    if (error instanceof GrowthIntervalError) {
      res.status(400).json({ error: error.message });
      return;
    }
    console.error("[growth:settings]", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Internal server error",
    });
  }
});

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

/**
 * Growth is calculated from a stable point-in-time rollup bucket, not from the
 * change log. Metric change rows are deliberately coalesced by the poller;
 * using their latest timestamp would incorrectly include part of a change
 * that happened before a rolling-window boundary.
 */
function metricDeltas(
  current: { followers: number; following: number; tweets: number },
  baseline: { followers: number; following: number; tweets: number } | undefined,
) {
  if (!baseline) {
    // A project first tracked inside the requested window has no pre-window
    // baseline, so do not represent its whole current count as new growth.
    return { followers: 0, following: 0, tweets: 0 };
  }
  return {
    followers: current.followers - baseline.followers,
    following: current.following - baseline.following,
    tweets: current.tweets - baseline.tweets,
  };
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
      include: {
        // Relation-local limit guarantees one latest tweet per project. A
        // global `take: projects.length` can omit quieter projects entirely.
        feedItems: {
          orderBy: [{ postedAt: "desc" }, { id: "desc" }],
          take: 1,
          select: {
            id: true,
            text: true,
            tweetUrl: true,
            postedAt: true,
            likes: true,
            reposts: true,
            replies: true,
          },
        },
      },
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

    // One DISTINCT ON query replaces N per-project snapshot subqueries:
    // finite windows read the newest hourly bucket at-or-before the window
    // start; "all" reads the earliest daily bucket.
    const baselineByUser = new Map<
      string,
      { followers: number; following: number; tweets: number }
    >();
    if (projects.length > 0) {
      const ids = projects.map((p) => p.userId);
      const granularity = since ? "hour" : "day";
      const order = since ? Prisma.raw("DESC") : Prisma.raw("ASC");
      const bucketCond = since
        ? Prisma.sql`AND r.bucket_start <= ${since}`
        : Prisma.empty;
      const rows = await prisma.$queryRaw<
        Array<{
          project_id: string;
          followers: number;
          following: number;
          tweets: number;
        }>
      >(Prisma.sql`
        SELECT DISTINCT ON (r.project_id)
          r.project_id, r.followers, r.following, r.tweets
        FROM project_metric_rollups r
        WHERE r.granularity = ${granularity}
          AND r.project_id IN (${Prisma.join(ids)})
          ${bucketCond}
        ORDER BY r.project_id, r.bucket_start ${order}
      `);
      for (const row of rows) {
        baselineByUser.set(row.project_id, {
          followers: row.followers,
          following: row.following,
          tweets: row.tweets,
        });
      }
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

    // Tweets published inside the window. Detection time can be delayed by a
    // poll or backfill, so it is not a meaningful publication-time metric.
    const tweetsInWindow = since
      ? await prisma.feedItem.groupBy({
          by: ["projectId"],
          where: {
            postedAt: { gte: since },
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

    const users = projects.map((project) => {
      const userChanges = changesByUser.get(project.userId) ?? [];
      const deltas = metricDeltas(project, baselineByUser.get(project.userId));

      const formattedChanges = userChanges.map((c) => ({
        field: c.field,
        oldValue: c.oldValue,
        newValue: c.newValue,
        changedAt: c.changedAt.toISOString(),
      }));

      const latestItem = project.feedItems[0];
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

growthRouter.get("/trend", async (req, res) => {
  try {
    const userId =
      typeof req.query.userId === "string" ? req.query.userId : null;
    if (!userId) {
      res.status(400).json({ error: "userId required" });
      return;
    }
    const range: TrendRange = parseTrendRange(req.query.range);
    const { granularity, since } = trendWindow(range);
    const rows = await prisma.projectMetricRollup.findMany({
      where: { projectId: userId, granularity, bucketStart: { gte: since } },
      orderBy: { bucketStart: "asc" },
    });
    res.json({
      userId,
      range,
      points: rows.map((r) => ({
        t: r.bucketStart.toISOString(),
        followers: r.followers,
        following: r.following,
        tweets: r.tweets,
      })),
    });
  } catch (error) {
    console.error("[growth:trend]", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Internal server error",
    });
  }
});
