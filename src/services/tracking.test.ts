import { afterAll, describe, it, expect } from "vitest";
import { prisma } from "../db/prisma.js";
import { applyUserPresence, type ProjectSnapshotInput } from "./tracking.js";
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
