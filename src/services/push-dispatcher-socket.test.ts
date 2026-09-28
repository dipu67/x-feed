import { afterAll, beforeAll, beforeEach, describe, it, expect, vi } from "vitest";
import { prisma } from "../db/prisma.js";
import { PushDispatcher } from "./push-dispatcher.js";
import type { FeedItem } from "../generated/prisma/client.js";

function makeItem(projectId: string, text: string): FeedItem {
  return {
    id: `socket-test-${Date.now()}-${Math.random()}`,
    projectId,
    username: "tester",
    text,
    tweetUrl: "https://x.com/i/status/1",
    postedAt: new Date(),
    likes: 0,
    reposts: 0,
    replies: 0,
    payload: { id: "x" },
    matchedKeywords: null,
    matchedCount: 0,
    detectedAt: new Date(),
  };
}

type FakeIo = {
  to: ReturnType<typeof vi.fn>;
  emit: ReturnType<typeof vi.fn>;
};

function makeFakeIo(): FakeIo {
  const emit = vi.fn();
  const to = vi.fn().mockReturnValue({ emit });
  return { to, emit };
}

beforeEach(async () => {
  await prisma.user.deleteMany({
    where: { email: { startsWith: "pd-socket-" } },
  });
  await prisma.telegramBinding.deleteMany({ where: {} });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("PushDispatcher socket fan-out", () => {
  it("emits feed:new to the bound user's room", async () => {
    const user = await prisma.user.create({
      data: {
        email: `pd-socket-${Date.now()}@test.local`,
        passwordHash: "x",
      },
    });
    const project = await prisma.project.create({
      data: {
        userId: `pd-socket-proj-${Date.now()}`,
        name: "P",
        username: `pdsocketproj${Date.now().toString().slice(-7)}`,
      },
    });
    await prisma.userFollow.create({
      data: { userId: user.id, projectId: project.userId },
    });

    const fake = makeFakeIo();
    // Cast: we only need .to(...).emit(...) for this test.
    const dispatcher = new PushDispatcher({ io: fake as unknown as never });
    const item = makeItem(project.userId, "hello world");

    await dispatcher.dispatchToFollowers(item);

    expect(fake.to).toHaveBeenCalledWith(`user:${user.id}`);
    expect(fake.emit).toHaveBeenCalledWith("feed:new", {
      id: item.id,
      text: item.text,
      tweetUrl: item.tweetUrl,
    });

    await prisma.userFollow.deleteMany({ where: { userId: user.id } });
    await prisma.project.deleteMany({ where: { userId: project.userId } });
    await prisma.user.delete({ where: { id: user.id } });
  });
});
