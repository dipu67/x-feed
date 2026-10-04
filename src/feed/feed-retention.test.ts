import { afterAll, beforeAll, describe, it, expect } from "vitest";
import { prisma } from "../db/prisma.js";
import {
  FEED_ITEMS_PER_PROJECT,
  pruneAllProjectFeedItems,
  pruneProjectFeedItems,
} from "./feed.js";

let projectId: string;

function postedAt(minutesAgo: number): Date {
  return new Date(Date.now() - minutesAgo * 60_000);
}

/** Create `n` items one minute apart; `suffix` keeps ids unique per caller. */
async function seedItems(
  targetProjectId: string,
  n: number,
  suffix: string,
  startMinutesAgo = 1,
) {
  for (let i = 0; i < n; i += 1) {
    await prisma.feedItem.create({
      data: {
        id: `prune-${suffix}-${Date.now()}-${i}`,
        projectId: targetProjectId,
        username: "u",
        text: `post ${i}`,
        tweetUrl: `https://x/${i}`,
        postedAt: postedAt(startMinutesAgo + i),
        payload: { id: `${i}` },
      },
    });
  }
}

beforeAll(async () => {
  projectId = `prune-${Date.now()}`;
  await prisma.project.create({
    data: { userId: projectId, name: "P", username: `up${Date.now()}` },
  });
  await seedItems(projectId, 14, "main");
});

afterAll(async () => {
  await prisma.project.delete({ where: { userId: projectId } });
  await prisma.$disconnect();
});

describe("pruneProjectFeedItems", () => {
  it("keeps the newest `keep` items and deletes older ones", async () => {
    const deleted = await pruneProjectFeedItems(projectId, 10);
    expect(deleted).toBe(4);

    const remaining = await prisma.feedItem.findMany({
      where: { projectId },
      orderBy: { postedAt: "desc" },
    });
    expect(remaining).toHaveLength(10);
    expect(remaining.map((item) => item.text)).toEqual([
      "post 0",
      "post 1",
      "post 2",
      "post 3",
      "post 4",
      "post 5",
      "post 6",
      "post 7",
      "post 8",
      "post 9",
    ]);
  });

  it("is a no-op when the project is within the cap", async () => {
    const deleted = await pruneProjectFeedItems(projectId, 10);
    expect(deleted).toBe(0);
  });

  it("defaults to FEED_ITEMS_PER_PROJECT", async () => {
    const freshProjectId = `prune-default-${Date.now()}`;
    await prisma.project.create({
      data: { userId: freshProjectId, name: "D", username: `ud${Date.now()}` },
    });
    try {
      await seedItems(freshProjectId, FEED_ITEMS_PER_PROJECT + 2, "default");
      const deleted = await pruneProjectFeedItems(freshProjectId);
      expect(deleted).toBe(2);
      const remaining = await prisma.feedItem.count({
        where: { projectId: freshProjectId },
      });
      expect(remaining).toBe(FEED_ITEMS_PER_PROJECT);
    } finally {
      await prisma.project.delete({ where: { userId: freshProjectId } });
    }
  });

  it("returns 0 for a project without feed items", async () => {
    const emptyProjectId = `prune-empty-${Date.now()}`;
    await prisma.project.create({
      data: { userId: emptyProjectId, name: "E", username: `ue${Date.now()}` },
    });
    try {
      expect(await pruneProjectFeedItems(emptyProjectId)).toBe(0);
    } finally {
      await prisma.project.delete({ where: { userId: emptyProjectId } });
    }
  });
});

describe("pruneAllProjectFeedItems", () => {
  it("prunes every project over the cap", async () => {
    // Push the test project back over the default cap; pruneAll must bring
    // it down to exactly FEED_ITEMS_PER_PROJECT.
    await seedItems(projectId, 8, "refill", 200);
    const deleted = await pruneAllProjectFeedItems();
    expect(deleted).toBeGreaterThanOrEqual(3);
    const count = await prisma.feedItem.count({ where: { projectId } });
    expect(count).toBe(FEED_ITEMS_PER_PROJECT);
  });
});
