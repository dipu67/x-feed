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
  // Hermetic: remove leftovers from any earlier crashed run first.
  await prisma.pushSubscription.deleteMany({
    where: { endpoint: { startsWith: "https://push.test/" } },
  });
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
  // The dispatcher broadcasts to EVERY subscription row in the DB — the dev
  // database holds real device subscriptions alongside the fixtures, so
  // assertions must count calls per fixture endpoint, never globally.
  function callsFor(endpointPrefix: string): number {
    return sendNotification.mock.calls.filter(
      (c) => (c[0] as { endpoint: string }).endpoint.startsWith(endpointPrefix),
    ).length;
  }

  it("sends every tweet to every subscriber, follow or not", async () => {
    sendNotification.mockClear();
    sendNotification.mockResolvedValue({});
    const d = new PushDispatcher({ concurrency: 8 });
    // No userFollow rows exist — the broadcast must not care.
    await d.dispatchToAllSubscribers(makeItem(projectId, "hello world"));

    expect(callsFor("https://push.test/owned-")).toBe(1);
    expect(callsFor("https://push.test/muted-")).toBe(1);
    expect(callsFor("https://push.test/anon-")).toBe(1);
  });

  it("honors a logged-in user's mute keyword for their own devices", async () => {
    sendNotification.mockClear();
    sendNotification.mockResolvedValue({});
    const d = new PushDispatcher({ concurrency: 8 });
    await d.dispatchToAllSubscribers(
      makeItem(projectId, "skipme — this one is muted"),
    );

    expect(callsFor("https://push.test/muted-")).toBe(0);
    expect(callsFor("https://push.test/owned-")).toBe(1);
    expect(callsFor("https://push.test/anon-")).toBe(1);
  });

  it("prunes dead subscriptions on 404", async () => {
    const deadEndpoint = `https://push.test/dead-${Date.now()}`;
    await prisma.pushSubscription.create({
      data: { endpoint: deadEndpoint, p256dh: "k1", auth: "k2", userId: null },
    });
    sendNotification.mockClear();
    sendNotification.mockImplementation((opts: unknown) => {
      const endpoint = (opts as { endpoint: string }).endpoint;
      return endpoint.startsWith("https://push.test/dead-")
        ? Promise.reject({ statusCode: 404 })
        : Promise.resolve({});
    });
    const d = new PushDispatcher({ concurrency: 8 });
    await d.dispatchToAllSubscribers(makeItem(projectId, "x"));

    expect(callsFor("https://push.test/dead-")).toBe(1);
    const remaining = await prisma.pushSubscription.findUnique({
      where: { endpoint: deadEndpoint },
    });
    expect(remaining).toBeNull();
  });
});
