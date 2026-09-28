import type { Server as SocketServer } from "socket.io";
import { prisma } from "../db/prisma.js";
import { fetchProfileStatusesPage } from "../fxTwitter/statuses.js";
import type { APITwitterStatus } from "../fxTwitter/types.js";
import { Prisma } from "../generated/prisma/client.js";
import { chunk } from "../lib/chunk.js";
import {
  compileKeywordMatcher,
  type KeywordMatcher,
  type MatchedKeyword,
} from "../lib/keywords.js";
import { sleep } from "../lib/sleep.js";
import { PushDispatcher } from "../services/push-dispatcher.js";
import { sendTelegramAlert } from "../services/telegram.js";
import { getTwitterClient } from "../twitter/getClient.js";
import { CircuitBreaker } from "../twitter/circuit-breaker.js";
import { withCircuitBreaker } from "./circuit-wrapped-call.js";
import {
  applyUserAbsence,
  applyUserPresence,
  type ProjectSnapshotInput,
} from "../services/tracking.js";
import { decidePoll } from "../TwitterClient/poll-scheduler.js";
import type { UserData } from "../TwitterClient/types.js";

const readBreakers = new Map<string, CircuitBreaker>();
function readBreakerFor(accountId: string): CircuitBreaker {
  let b = readBreakers.get(accountId);
  if (!b) {
    b = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 15 * 60 * 1000 });
    readBreakers.set(accountId, b);
  }
  return b;
}

let pushDispatcher: PushDispatcher | null = null;
function getDispatcher(io: FeedSocket): PushDispatcher {
  if (!pushDispatcher) pushDispatcher = new PushDispatcher({ io });
  return pushDispatcher;
}

const BATCH_SIZE = 100;
const CYCLE_MS =  60 * 1000; // every 60s

type FeedSocket = SocketServer;

function toPostedAt(status: APITwitterStatus): Date {
  if (status.created_timestamp) {
    return new Date(status.created_timestamp * 1000);
  }
  const parsed = new Date(status.created_at);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function toFeedPayload(status: APITwitterStatus, projectId: string) {
  return {
    id: status.id,
    projectId,
    username: status.author.screen_name,
    text: status.text,
    tweetUrl: status.url,
    postedAt: toPostedAt(status),
    likes: status.likes,
    reposts: status.reposts,
    replies: status.replies,
    payload: status as unknown as object,
  };
}

async function waitForRateLimit(resetUnix?: number) {
  if (!resetUnix) {
    await sleep(CYCLE_MS);
    return;
  }
  const waitMs = Math.max(resetUnix * 1000 - Date.now(), 1_000) + 1_000;
  console.log(`[feed] rate limited, waiting ${Math.round(waitMs / 1000)}s`);
  await sleep(waitMs);
}



async function persistAndEmit(
  io: FeedSocket,
  project: {
    userId: string;
    name: string;
    username: string;
    chain: string | null;
    tokenAddress: string | null;
    profileImageUrl: string | null;
  },
  statuses: APITwitterStatus[],
  matcher: KeywordMatcher,
) {
  const created = [];
  for (const status of statuses) {
    const data = toFeedPayload(status, project.userId);
    // Defensive per spec §11: classification must never fail ingestion.
    let matched: MatchedKeyword[] = [];
    try {
      matched = matcher.match(data.text);
    } catch (error) {
      console.error("[feed] keyword match failed:", error);
    }
    // Both columns are written on create AND update so a tweet edit that
    // removes the keyword clears stale matches (matchedCount back to 0).
    const matchData = {
      matchedKeywords:
        matched.length > 0
          ? (matched as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull,
      matchedCount: matched.length,
    };
    const existing = await prisma.feedItem.findUnique({
      where: { id: data.id },
      select: { id: true },
    });
    const item = existing
      ? await prisma.feedItem.update({
          where: { id: data.id },
          data: {
            text: data.text,
            likes: data.likes,
            reposts: data.reposts,
            replies: data.replies,
            payload: data.payload,
            ...matchData,
          },
        })
      : await prisma.feedItem.create({ data: { ...data, ...matchData } });

    // A push is only for a newly detected post. Existing items are refreshed
    // for engagement counts on later cycles and must not notify again.
    if (existing) continue;

    created.push(item);
    const feedEvent = {
      id: item.id,
      projectId: item.projectId,
      username: item.username,
      text: item.text,
      tweetUrl: item.tweetUrl,
      postedAt: item.postedAt.toISOString(),
      likes: item.likes,
      reposts: item.reposts,
      replies: item.replies,
      payload: item.payload,
      detectedAt: item.detectedAt.toISOString(),
      matchedKeywords: matched.length > 0 ? matched : null,
      project: {
        userId: project.userId,
        name: project.name,
        username: project.username,
        chain: project.chain,
        tokenAddress: project.tokenAddress,
        profileImageUrl: project.profileImageUrl,
      },
    };
    io.emit("feed:new", feedEvent);
    void getDispatcher(io).dispatchToFollowers(item);

    // Keyword matches also alert the operator chat on Telegram. Per-user push
    // is the dispatcher's job above; this is the global alpha alert.
    if (matched.length > 0) {
      const label = matched.map((m) => m.tag ?? m.phrase).join(", ");
      void sendTelegramAlert({
        label,
        username: item.username,
        text: item.text,
        url: item.tweetUrl,
      });
    }
  }
  return created;
}

async function runCycle(io: FeedSocket): Promise<void> {
  const projects = await prisma.project.findMany();
  if (projects.length === 0) {
    console.log("[feed] no projects yet");
    return;
  }

  // One matcher per cycle: fresh keywords without a DB read per tweet.
  const keywords = await prisma.keyword.findMany({ where: { enabled: true } });
  const matcher = compileKeywordMatcher(keywords);

  // Seed baseline snapshots for any project that has none yet, so the growth
  // route has a reference value for any "all" / wide window. This is a
  // one-shot per project for the lifetime of the DB.
  const withoutSnapshot = await prisma.project.findMany({
    where: { snapshots: { none: {} } },
    select: {
      userId: true,
      followers: true,
      following: true,
      tweets: true,
      status: true,
    },
  });
  if (withoutSnapshot.length > 0) {
    await prisma.projectSnapshot.createMany({
      data: withoutSnapshot.map((p) => ({
        projectId: p.userId,
        followers: p.followers,
        following: p.following,
        tweets: p.tweets,
        status: p.status,
        capturedAt: new Date(),
      })),
    });
    console.log(
      `[feed] seeded ${withoutSnapshot.length} baseline snapshot(s)`,
    );
  }

  const byUserId = new Map(projects.map((project) => [project.userId, project]));
  const { client, accountId } = await getTwitterClient();
  const readBreaker = readBreakerFor(accountId);

  // Build a lastTweetAt lookup so the polling-decision check can skip
  // accounts that haven't tweeted in 7+ days (1/4 polling frequency).
  const latestItems = await prisma.feedItem.findMany({
    where: { projectId: { in: projects.map((p) => p.userId) } },
    orderBy: { postedAt: "desc" },
    select: { projectId: true, postedAt: true },
    distinct: ["projectId"],
  });
  const lastTweetAtByProjectId = new Map(
    latestItems.map((item) => [item.projectId, item.postedAt]),
  );

  // Apply the poll-scheduler: filter out inactive projects from the batch list.
  const skippedInactive: string[] = [];
  const pollableUserIds: string[] = [];
  for (const project of projects) {
    const lastTweetAt = lastTweetAtByProjectId.get(project.userId) ?? null;
    const decision = decidePoll({ lastTweetAt });
    if (decision.pollNow) {
      pollableUserIds.push(project.userId);
    } else {
      skippedInactive.push(project.userId);
    }
  }
  if (skippedInactive.length > 0) {
    console.log(
      `[feed] skipping ${skippedInactive.length} inactive project(s) (no tweets in 7d)`,
    );
  }

  const batches = chunk(pollableUserIds, BATCH_SIZE);

  console.log(
    `[feed] polling ${pollableUserIds.length}/${projects.length} projects in ${batches.length} batch(es)`,
  );

  // Track which projects were returned by X this cycle so the absence pass
  // below can mark suspended/missing ones.
  const presentIds = new Set<string>();

  for (const userIds of batches) {
    const call = await withCircuitBreaker(readBreaker, () =>
      client.getUsersByIds(userIds),
    );
    if ("skipped" in call) {
      console.warn(
        `[feed] read breaker open for account=${accountId}; skipping ${userIds.length} ids`,
      );
      continue;
    }
    const result = call;
    if (!result.success || !result.users) {
      // A hard API failure (rate limit, network) is NOT a suspension signal —
      // the whole batch is missing, so don't run the absence pass.
      console.error("[feed] usersByIds failed:", result.error);
      if (result.rateLimit && result.rateLimit.remaining <= 0) {
        await waitForRateLimit(result.rateLimit.reset);
      }
      continue;
    }

    for (const user of result.users) {
      const project = byUserId.get(user.id);
      if (!project) continue;
      presentIds.add(user.id);

      const newCount = user.tweetCount ?? project.tweets;
      const hadNewTweets = newCount > project.tweets;
      let cursorTop = project.fxTwitterCursorTop;

      try {
        if (hadNewTweets) {
          const page = await fetchProfileStatusesPage(user.username, cursorTop);
          cursorTop = page.cursorTop;
          if (page.statuses.length > 0) {
            await persistAndEmit(io, project, page.statuses, matcher);
            console.log(
              `[feed] @${user.username} +${page.statuses.length} tweet(s)`,
            );
          }
        }
      } catch (error) {
        console.error(
          `[feed] fxTwitter failed for @${user.username}:`,
          error instanceof Error ? error.message : error,
        );
      }

      // Persist metrics + profile fields via the tracking service: it writes
      // a ProjectChange row only when something actually moved and snapshots
      // on movement. Reset missedChecks (the user is visible to X).
      const trackingInput = toTrackingInput(project, user);
      const { changes, statusChanged } = await applyUserPresence(
        trackingInput,
        user,
      );

      await prisma.project.update({
        where: { userId: project.userId },
        data: {
          fxTwitterCursorTop: cursorTop,
          lastFetchedAt: new Date(),
        },
      });

      if (changes.length > 0) {
        console.log(
          `[feed] @${project.username} changed: ${changes
            .map((c) => c.field)
            .join(", ")}`,
        );
      }
      if (statusChanged) {
        console.log(`[feed] @${project.username} back to active`);
      }
    }

    // Absence pass: any requested id X did not return for this successful
    // batch is missing. A single miss doesn't change status; three
    // consecutive misses mark the account suspended.
    for (const missingId of userIds) {
      if (presentIds.has(missingId)) continue;
      const project = byUserId.get(missingId);
      if (!project) continue;
      const absence = await applyUserAbsence(toTrackingInput(project));
      if (absence.statusChanged) {
        console.log(
          `[feed] @${project.username} marked suspended (${absence.missedChecks} consecutive misses)`,
        );
      }
    }

    if (result.rateLimit && result.rateLimit.remaining <= 0) {
      await waitForRateLimit(result.rateLimit.reset);
    }
  }
}

/**
 * Shape a Project row (joined with the fields applyUserPresence uses) so the
 * tracking service can diff it against a fresh X user payload.
 */
function toTrackingInput(
  project: Awaited<ReturnType<typeof prisma.project.findMany>>[number],
  user?: UserData,
): ProjectSnapshotInput {
  return {
    userId: project.userId,
    username: project.username,
    twitterName: project.twitterName,
    twitterBio: project.twitterBio,
    location: project.location,
    isBlueVerified: project.isBlueVerified,
    profileImageUrl: project.profileImageUrl,
    website: project.website,
    followers: project.followers,
    following: project.following,
    tweets: project.tweets,
    status: project.status,
    missedChecks: project.missedChecks,
  };
  // Suppress unused warning when `user` not provided (presence calls).
  void user;
}

export function startFeedWorker(io: FeedSocket): void {
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    const started = Date.now();
    try {
      await runCycle(io);
    } catch (error) {
      console.error(
        "[feed] cycle failed:",
        error instanceof Error ? error.message : error,
      );
    } finally {
      running = false;
      const wait = Math.max(CYCLE_MS - (Date.now() - started), 5_000);
      console.log(`[feed] next cycle in ${Math.round(wait / 1000)}s`);
      setTimeout(() => {
        void tick();
      }, wait);
    }
  };

  void tick();
}
