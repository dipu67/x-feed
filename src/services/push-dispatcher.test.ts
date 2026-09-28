import { afterAll, beforeAll, describe, it, expect, vi } from "vitest";
import { prisma } from "../db/prisma.js";
import { hashPassword } from "../auth/password.js";
import { PushDispatcher } from "./push-dispatcher.js";
import type { FeedItem } from "../generated/prisma/client.js";

let userId: string;
let mutedUserId: string;
let projectId: string;
const sendNotification = vi.fn();

vi.mock("web-push", () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: (...args: unknown[]) => sendNotification(...args),
  },
}));

function makeItem(projectId: string, text: string): FeedItem {
  return {
    id: `pd-test-${Date.now()}-${Math.random()}`,
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

beforeAll(async () => {
  sendNotification.mockReset();
  sendNotification.mockResolvedValue({});
  const u = await prisma.user.create({
    data: {
      email: `push-${Date.now()}@t.local`,
      passwordHash: await hashPassword("passwordpassword1"),
    },
  });
  userId = u.id;
  const m = await prisma.user.create({
    data: {
      email: `push-muted-${Date.now()}@t.local`,
      passwordHash: await hashPassword("passwordpassword1"),
    },
  });
  mutedUserId = m.id;
  await prisma.muteKeyword.create({
    data: { userId: mutedUserId, pattern: "skipme" },
  });
  const p = await prisma.project.create({
    data: { userId: `pp-${Date.now()}`, name: "P", username: `pp${Date.now()}` },
  });
  projectId = p.userId;
  await prisma.pushSubscription.create({
    data: {
      endpoint: `https://push.test/owned-${Date.now()}`,
      p256dh: "k1",
      auth: "k2",
      userId,
    },
  });
  await prisma.pushSubscription.create({
    data: {
      endpoint: `https://push.test/muted-${Date.now()}`,
      p256dh: "k1",
      auth: "k2",
      userId: mutedUserId,
    },
  });
  await prisma.pushSubscription.create({
    data: {
      endpoint: `https://push.test/anon-${Date.now()}`,
      p256dh: "k1",
      auth: "k2",
      userId: null,
    },
  });
});

afterAll(async () => {
  await prisma.pushSubscription.deleteMany({
    where: { endpoint: { startsWith: "https://push.test/" } },
  });
  await prisma.muteKeyword.deleteMany({ where: { userId: mutedUserId } });
  await prisma.project.deleteMany({ where: { userId: projectId } });
  await prisma.user.deleteMany({ where: { id: { in: [userId, mutedUserId] } } });
  await prisma.$disconnect();
});

describe("PushDispatcher.dispatchToAllSubscribers", () => {
  it("sends every tweet to every subscriber, follow or not", async () => {
    sendNotification.mockClear();
    sendNotification.mockResolvedValue({});
    const d = new PushDispatcher({ concurrency: 8 });
    // No userFollow rows exist — the broadcast must not care.
    await d.dispatchToAllSubscribers(makeItem(projectId, "hello world"));

    const endpoints = sendNotification.mock.calls.map(
      (call) => (call[0] as { endpoint: string }).endpoint,
    );
    expect(endpoints.length).toBe(3);
    expect(endpoints.some((e) => e.startsWith("https://push.test/owned-"))).toBe(true);
    expect(endpoints.some((e) => e.startsWith("https://push.test/muted-"))).toBe(true);
    expect(endpoints.some((e) => e.startsWith("https://push.test/anon-"))).toBe(true);
  });

  it("honors a logged-in user's mute keyword for their own devices", async () => {
    sendNotification.mockClear();
    sendNotification.mockResolvedValue({});
    const d = new PushDispatcher({ concurrency: 8 });
    await d.dispatchToAllSubscribers(
      makeItem(projectId, "skipme — this one is muted"),
    );

    const endpoints = sendNotification.mock.calls.map(
      (call) => (call[0] as { endpoint: string }).endpoint,
    );
    expect(endpoints.length).toBe(2);
    expect(endpoints.some((e) => e.startsWith("https://push.test/muted-"))).toBe(false);
    expect(endpoints.some((e) => e.startsWith("https://push.test/owned-"))).toBe(true);
    expect(endpoints.some((e) => e.startsWith("https://push.test/anon-"))).toBe(true);
  });

  it("prunes dead subscriptions on 404", async () => {
    sendNotification.mockClear();
    sendNotification.mockRejectedValueOnce({ statusCode: 404 });
    const d = new PushDispatcher({ concurrency: 8 });
    await d.dispatchToAllSubscribers(makeItem(projectId, "x"));
    // One send attempted per subscription; the 404 endpoint is removed.
    expect(sendNotification).toHaveBeenCalledTimes(3);
    const remaining = await prisma.pushSubscription.count({
      where: { endpoint: { startsWith: "https://push.test/" } },
    });
    expect(remaining).toBe(2);
  });
});
