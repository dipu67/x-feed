import { afterAll, beforeAll, describe, it, expect } from "vitest";
import { prisma } from "../db/prisma.js";
import {
  pruneAllProjectFeedItems,
  pruneProjectFeedItems,
} from "./feed.js";

let projectId: string;

function postedAt(minutesAgo: number): Date {
  return new Date(Date.now() - minutesAgo * 60_000);
}

beforeAll(async () => {
  projectId = `prune-${Date.now()}`;
  await prisma.project.create({
    data: { userId: projectId, name: "P", username: `up${Date.now()}` },
  });
  // 14 items, one per minute, so the newest 10 are unambiguous.
  for (let i = 0; i < 14; i += 1) {
    await prisma.feedItem.create({
      data: {
        id: `prune-item-${Date.now()}-${i}`,
        projectId,
        username: "u",
        text: `post ${i}`,
        tweetUrl: `https://x/${i}`,
        postedAt: postedAt(i + 1),
        payload: { id: `${i}` },
      },
    });
  }
});

afterAll(async () => {
  await prisma.project.delete({ where: { userId: projectId } });
  await prisma.$disconnect();
});

describe("pruneProjectFeedItems", () => {
  it("keeps the newest 10 and deletes older ones", async () => {
    const deleted = await pruneProjectFeedItems(projectId);
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
    const deleted = await pruneProjectFeedItems(projectId);
    expect(deleted).toBe(0);
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
    // Refill the project over the cap (14 items again after the earlier prune).
    for (let i = 0; i < 8; i += 1) {
      await prisma.feedItem.create({
        data: {
          id: `prune-refill-${Date.now()}-${i}`,
          projectId,
          username: "u",
          text: `old ${i}`,
          tweetUrl: `https://x/old/${i}`,
          postedAt: postedAt(100 + i),
          payload: { id: `old-${i}` },
        },
      });
    }
    const deleted = await pruneAllProjectFeedItems();
    expect(deleted).toBeGreaterThanOrEqual(4);
    const count = await prisma.feedItem.count({ where: { projectId } });
    expect(count).toBe(10);
  });
});
