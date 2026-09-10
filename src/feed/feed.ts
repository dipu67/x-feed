import type { Server as SocketServer } from "socket.io";
import { prisma } from "../db/prisma.js";
import { fetchProfileStatusesPage } from "../fxTwitter/statuses.js";
import type { APITwitterStatus } from "../fxTwitter/types.js";
import { chunk } from "../lib/chunk.js";
import { sleep } from "../lib/sleep.js";
import { getTwitterClient } from "../twitter/getClient.js";

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

  const byUserId = new Map(projects.map((project) => [project.userId, project]));
  const client = await getTwitterClient();
  const batches = chunk(
    projects.map((project) => project.userId),
    BATCH_SIZE,
  );

  console.log(
    `[feed] polling ${projects.length} projects in ${batches.length} batch(es)`,
  );

  for (const userIds of batches) {
    const result = await client.getUsersByIds(userIds);
    if (!result.success || !result.users) {
      console.error("[feed] usersByIds failed:", result.error);
      if (result.rateLimit && result.rateLimit.remaining <= 0) {
        await waitForRateLimit(result.rateLimit.reset);
      }
      continue;
    }

    for (const user of result.users) {
      const project = byUserId.get(user.id);
      if (!project) continue;

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

      await prisma.project.update({
        where: { userId: project.userId },
        data: {
          username: user.username,
          twitterName: user.name,
          followers: user.followersCount ?? project.followers,
          following: user.followingCount ?? project.following,
          tweets: newCount,
          profileImageUrl: user.profileImageUrl ?? project.profileImageUrl,
          fxTwitterCursorTop: cursorTop,
          lastFetchedAt: new Date(),
        },
      });
    }

    if (result.rateLimit && result.rateLimit.remaining <= 0) {
      await waitForRateLimit(result.rateLimit.reset);
    }
  }
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
