import { afterAll, describe, it, expect } from "vitest";
import { prisma } from "../db/prisma.js";
import { applyUserPresence, type ProjectSnapshotInput } from "./tracking.js";
import { pruneRollupsDaily } from "../feed/feed.js";
import type { UserData } from "../TwitterClient/types.js";

const projectId = `rollup-test-${Date.now()}`;

function input(overrides: Partial<ProjectSnapshotInput>): ProjectSnapshotInput {
  return {
    userId: projectId,
    username: "rolluptest",
    twitterName: null,
    twitterBio: null,
    location: null,
    isBlueVerified: false,
    profileImageUrl: null,
    website: null,
    followers: 100,
    following: 50,
    tweets: 10,
    status: "active",
    missedChecks: 0,
    ...overrides,
  };
}

const user = (followers: number, following: number, tweets: number): UserData =>
  ({
    id: projectId,
    username: "rolluptest",
    followersCount: followers,
    followingCount: following,
    tweetCount: tweets,
  }) as unknown as UserData;

afterAll(async () => {
  // Scoped, fully-defined deletes only (see Global Constraints).
  await prisma.projectMetricRollup.deleteMany({
    where: { projectId: { startsWith: "rollup-test-" } },
  });
  await prisma.projectChange.deleteMany({
    where: { projectId: { startsWith: "rollup-test-" } },
  });
  await prisma.project.deleteMany({
    where: { userId: { startsWith: "rollup-test-" } },
  });
  await prisma.$disconnect();
});

describe("applyUserPresence rollup writes", () => {
  it("upserts hour and day buckets without creating new rows on jitter", async () => {
    await prisma.project.create({
      data: { userId: projectId, name: "R", username: "rolluptest" },
    });

    await applyUserPresence(input({}), user(100, 50, 10));
    const afterFirst = await prisma.projectMetricRollup.findMany({
      where: { projectId },
    });
    expect(afterFirst.length).toBe(2); // hour + day
    expect(
      afterFirst.every((r) => r.followers === 100 && r.tweets === 10),
    ).toBe(true);

    // Jitter cycles in the same buckets must UPDATE, not insert.
    await applyUserPresence(input({ followers: 101 }), user(101, 50, 11));
    const afterSecond = await prisma.projectMetricRollup.findMany({
      where: { projectId },
    });
    expect(afterSecond.length).toBe(2);
    const hourRow = afterSecond.find((r) => r.granularity === "hour");
    expect(hourRow?.followers).toBe(101);
    expect(hourRow?.tweets).toBe(11);

    // No snapshot rows may be written anymore.
    const snaps = await prisma.projectSnapshot.count({
      where: { projectId },
    });
    expect(snaps).toBe(0);
  });
});

describe("pruneRollupsDaily", () => {
  it("deletes only hourly buckets older than 30 days", async () => {
    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;
    await prisma.projectMetricRollup.create({
      data: {
        projectId,
        granularity: "hour",
        bucketStart: new Date(now - 40 * DAY),
        followers: 1,
        following: 1,
        tweets: 1,
      },
    });
    await prisma.projectMetricRollup.create({
      data: {
        projectId,
        granularity: "day",
        bucketStart: new Date(now - 40 * DAY),
        followers: 1,
        following: 1,
        tweets: 1,
      },
    });

    await pruneRollupsDaily(new Date(now));

    const hourly = await prisma.projectMetricRollup.findMany({
      where: { projectId, granularity: "hour" },
    });
    expect(hourly.length).toBe(1); // the 40d-old hourly row is gone
    expect(
      hourly.every(
        (r) => r.bucketStart.getTime() > now - 30 * DAY,
      ),
    ).toBe(true);
    const daily = await prisma.projectMetricRollup.count({
      where: { projectId, granularity: "day" },
    });
    // The 40d-old daily row from this test + today's daily row from the
    // Task 3 test (same vitest process, same UTC day).
    expect(daily).toBe(2);
    // The 40d-old hourly row was deleted by the sweep above; the remaining
    // rows are cleaned up by the scoped afterAll deletes.
  });
});
