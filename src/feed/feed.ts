import type { Server as SocketServer } from "socket.io";
import { prisma } from "../db/prisma.js";
import { fetchProfileStatusesPage } from "../fxTwitter/statuses.js";
import type { APITwitterStatus } from "../fxTwitter/types.js";
import { chunk } from "../lib/chunk.js";
import { sleep } from "../lib/sleep.js";
import { getTwitterClient } from "../twitter/getClient.js";
import {
  applyUserAbsence,
  applyUserPresence,
  type ProjectSnapshotInput,
} from "../services/tracking.js";
import type { UserData } from "../TwitterClient/types.js";

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
) {
  const created = [];
  for (const status of statuses) {
    const data = toFeedPayload(status, project.userId);
    const item = await prisma.feedItem.upsert({
      where: { id: data.id },
      create: data,
      update: {
        text: data.text,
        likes: data.likes,
        reposts: data.reposts,
        replies: data.replies,
        payload: data.payload,
      },
    });
    created.push(item);
    io.emit("feed:new", {
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
      project: {
        userId: project.userId,
        name: project.name,
        username: project.username,
        chain: project.chain,
        tokenAddress: project.tokenAddress,
        profileImageUrl: project.profileImageUrl,
      },
    });
  }
  return created;
}

async function runCycle(io: FeedSocket): Promise<void> {
  const projects = await prisma.project.findMany();
  if (projects.length === 0) {
    console.log("[feed] no projects yet");
    return;
  }

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
  const client = await getTwitterClient();
  const batches = chunk(
    projects.map((project) => project.userId),
    BATCH_SIZE,
  );

  console.log(
    `[feed] polling ${projects.length} projects in ${batches.length} batch(es)`,
  );

  // Track which projects were returned by X this cycle so the absence pass
  // below can mark suspended/missing ones.
  const presentIds = new Set<string>();

  for (const userIds of batches) {
    const result = await client.getUsersByIds(userIds);
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
            await persistAndEmit(io, project, page.statuses);
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
      const result = await applyUserAbsence(toTrackingInput(project));
      if (result.statusChanged) {
        console.log(
          `[feed] @${project.username} marked suspended (${result.missedChecks} consecutive misses)`,
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
