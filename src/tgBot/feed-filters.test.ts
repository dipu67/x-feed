import { afterAll, beforeAll, beforeEach, describe, it, expect } from "vitest";
import { prisma } from "../db/prisma.js";
import {
  handleFeedCommand,
  handleFiltersCommand,
} from "./commands.js";

const chatId = 5555555;

let userId: string;
let projectId: string;

beforeAll(async () => {
  const u = await prisma.user.create({
    data: {
      email: `tg-feed-user-${Date.now()}@test.local`,
      passwordHash: "x",
    },
  });
  userId = u.id;
  const project = await prisma.project.create({
    data: {
      userId: `tg-feed-proj-${Date.now()}`,
      name: "Test Project",
      username: `tgfeedproj${Date.now().toString().slice(-7)}`,
    },
  });
  projectId = project.userId;
});

beforeEach(async () => {
  await prisma.telegramBinding.deleteMany({ where: { chatId: BigInt(chatId) } });
  await prisma.userFollow.deleteMany({ where: { userId } });
  await prisma.filter.deleteMany({ where: { userId } });
  await prisma.muteKeyword.deleteMany({ where: { userId } });
  await prisma.feedItem.deleteMany({ where: { projectId } });
  await prisma.telegramBinding.create({
    data: { chatId: BigInt(chatId), userId },
  });
});

afterAll(async () => {
  await prisma.telegramBinding.deleteMany({ where: { chatId: BigInt(chatId) } });
  await prisma.userFollow.deleteMany({ where: { userId } });
  await prisma.filter.deleteMany({ where: { userId } });
  await prisma.muteKeyword.deleteMany({ where: { userId } });
  await prisma.feedItem.deleteMany({ where: { projectId } });
  await prisma.project.deleteMany({ where: { userId: projectId } });
  await prisma.user.delete({ where: { id: userId } });
  await prisma.$disconnect();
});

async function seedFeedItem(text: string): Promise<void> {
  await prisma.feedItem.create({
    data: {
      id: `tweet-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      projectId,
      username: "test",
      text,
      tweetUrl: `https://x.com/test/status/${Math.floor(Math.random() * 1e10)}`,
      postedAt: new Date(),
      payload: { id: "x" },
    },
  });
}

describe("handleFeedCommand", () => {
  it("returns not_linked when there is no binding", async () => {
    await prisma.telegramBinding.deleteMany({ where: { chatId: BigInt(chatId) } });
    const result = await handleFeedCommand(chatId, 10);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("not_linked");
  });

  it("returns items limited by n, newest first", async () => {
    // User is bound but follows nothing — empty followSet means follow
    // visibility is "show only followed projects" which is empty, so nothing
    // passes. Follow the project first.
    await prisma.userFollow.create({ data: { userId, projectId } });
    await seedFeedItem("first tweet");
    await seedFeedItem("second tweet");
    await seedFeedItem("third tweet");
    const result = await handleFeedCommand(chatId, 2);
    expect(result.ok).toBe(true);
    if (result.ok && result.items) {
      expect(result.items).toHaveLength(2);
      // Newest first by postedAt — last seeded is the newest.
      expect(result.items[0]?.text).toBe("third tweet");
    }
  });

  it("hides items matching an active filter", async () => {
    await prisma.userFollow.create({ data: { userId, projectId } });
    await prisma.filter.create({
      data: {
        userId,
        name: "Hide spam",
        kind: "keyword",
        pattern: "spam",
        action: "hide",
      },
    });
    await seedFeedItem("hello world");
    await seedFeedItem("this is spam content");
    const result = await handleFeedCommand(chatId, 10);
    expect(result.ok).toBe(true);
    if (result.ok && result.items) {
      expect(result.items.map((i) => i.text)).toEqual(["hello world"]);
    }
  });

  it("hides items matching a mute keyword", async () => {
    await prisma.userFollow.create({ data: { userId, projectId } });
    await prisma.muteKeyword.create({
      data: { userId, pattern: "spam", isRegex: false },
    });
    await seedFeedItem("visible");
    await seedFeedItem("spam noise");
    const result = await handleFeedCommand(chatId, 10);
    expect(result.ok).toBe(true);
    if (result.ok && result.items) {
      expect(result.items.map((i) => i.text)).toEqual(["visible"]);
    }
  });
});

describe("handleFiltersCommand", () => {
  it("returns not_linked when there is no binding", async () => {
    await prisma.telegramBinding.deleteMany({ where: { chatId: BigInt(chatId) } });
    const result = await handleFiltersCommand(chatId);
    expect(result.ok).toBe(false);
  });

  it("returns the user's filters (active and inactive)", async () => {
    await prisma.filter.create({
      data: {
        userId,
        name: "A",
        kind: "keyword",
        pattern: "x",
        action: "hide",
        isActive: true,
      },
    });
    await prisma.filter.create({
      data: {
        userId,
        name: "B",
        kind: "keyword",
        pattern: "y",
        action: "hide",
        isActive: false,
      },
    });
    const result = await handleFiltersCommand(chatId);
    expect(result.ok).toBe(true);
    if (result.ok && result.filters) {
      const filters = result.filters as Array<{ name: string; isActive: boolean }>;
      expect(filters.map((f) => f.name).sort()).toEqual(["A", "B"]);
      expect(filters.find((f) => f.name === "A")?.isActive).toBe(true);
      expect(filters.find((f) => f.name === "B")?.isActive).toBe(false);
    }
  });
});
