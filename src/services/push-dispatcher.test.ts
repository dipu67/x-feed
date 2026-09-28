import { afterAll, beforeAll, describe, it, expect, vi } from "vitest";
import { prisma } from "../db/prisma.js";
import { hashPassword } from "../auth/password.js";
import { PushDispatcher } from "./push-dispatcher.js";

let userId: string;
let projectId: string;
const sendNotification = vi.fn();

vi.mock("web-push", () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: (...args: unknown[]) => sendNotification(...args),
  },
}));

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
  const p = await prisma.project.create({
    data: { userId: `pp-${Date.now()}`, name: "P", username: `pp${Date.now()}` },
  });
  projectId = p.userId;
  await prisma.userFollow.create({ data: { userId, projectId } });
  await prisma.pushSubscription.create({
    data: {
      endpoint: `https://push.test/${Date.now()}`,
      p256dh: "k1",
      auth: "k2",
      userId,
    },
  });
});

afterAll(async () => {
  await prisma.pushSubscription.deleteMany({ where: { userId } });
  await prisma.userFollow.deleteMany({ where: { userId } });
  await prisma.project.deleteMany({ where: { userId: projectId } });
  await prisma.user.delete({ where: { id: userId } });
  await prisma.$disconnect();
});

describe("PushDispatcher.dispatchToFollowers (Review Focus #4)", () => {
  it("fans out to followers only", async () => {
    sendNotification.mockClear();
    sendNotification.mockResolvedValue({});
    const d = new PushDispatcher({ concurrency: 8 });
    await d.dispatchToFollowers({
      id: "f1",
      projectId,
      username: "u",
      text: "hello",
      tweetUrl: "https://x/1",
      postedAt: new Date(),
      likes: 0,
      reposts: 0,
      replies: 0,
      payload: {},
      matchedKeywords: null,
      matchedCount: 0,
      detectedAt: new Date(),
    });
    expect(sendNotification).toHaveBeenCalledTimes(1);
  });

  it("prunes dead subscriptions on 404", async () => {
    sendNotification.mockReset();
    sendNotification.mockRejectedValueOnce({ statusCode: 404 });
    const d = new PushDispatcher({ concurrency: 8 });
    await d.dispatchToUser(userId, {
      id: "f2",
      projectId,
      username: "u",
      text: "x",
      tweetUrl: "u",
      postedAt: new Date(),
      likes: 0,
      reposts: 0,
      replies: 0,
      payload: {},
      matchedKeywords: null,
      matchedCount: 0,
      detectedAt: new Date(),
    });
    const count = await prisma.pushSubscription.count({ where: { userId } });
    expect(count).toBe(0);
  });

  it("fans out to many followers concurrently without sequential stalls (Review Focus #4)", async () => {
    sendNotification.mockReset();
    sendNotification.mockResolvedValue({});
    const N = 50;
    const extras = await Promise.all(
      Array.from({ length: N }, () =>
        prisma.user.create({
          data: { email: `backpressure-${Math.random()}@t.local`, passwordHash: "x" },
        }),
      ),
    );
    await Promise.all(
      extras.map((u) =>
        prisma.pushSubscription.create({
          data: { endpoint: `https://push.test/${u.id}`, p256dh: "k", auth: "k", userId: u.id },
        }),
      ),
    );
    await Promise.all(
      extras.map((u) => prisma.userFollow.create({ data: { userId: u.id, projectId } })),
    );
    const d = new PushDispatcher({ concurrency: 16 });
    const t0 = Date.now();
    await d.dispatchToFollowers({
      id: "bp",
      projectId,
      username: "u",
      text: "hi",
      tweetUrl: "u",
      postedAt: new Date(),
      likes: 0,
      reposts: 0,
      replies: 0,
      payload: {},
      matchedKeywords: null,
      matchedCount: 0,
      detectedAt: new Date(),
    });
    const elapsed = Date.now() - t0;
    // 50 sequential @10ms would be 500ms; with concurrency it should be well under.
    expect(elapsed).toBeLessThan(3000);
    expect(sendNotification.mock.calls.length).toBeGreaterThanOrEqual(N);
    await prisma.pushSubscription.deleteMany({ where: { userId: { in: extras.map((u) => u.id) } } });
    await prisma.userFollow.deleteMany({ where: { userId: { in: extras.map((u) => u.id) } } });
    await prisma.user.deleteMany({ where: { id: { in: extras.map((u) => u.id) } } });
  });

  it("caps concurrent web-push calls per dispatch to the configured cap", async () => {
    // The concurrency field is the operator-tunable backpressure cap for
    // the inner sub-fan-out (web-push delivery per subscriber). If we never
    // apply it, the worst case is unbounded Promise.all across a hot user
    // with thousands of subs — web-push library's socket pool will happily
    // try every connection at once and choke the host.
    sendNotification.mockReset();
    const N = 60;
    const CAP = 8;

    const inserted = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        prisma.pushSubscription.create({
          data: {
            endpoint: `https://push.test/cap-${i}-${Date.now()}-${Math.random()}`,
            p256dh: "k",
            auth: "k",
            userId,
          },
        }),
      ),
    );

    // Track max in-flight via instrumentation on the mock.
    let inFlight = 0;
    let maxInFlight = 0;
    sendNotification.mockImplementation(async () => {
      inFlight++;
      if (inFlight > maxInFlight) maxInFlight = inFlight;
      try {
        await new Promise((r) => setTimeout(r, 25));
        return {};
      } finally {
        inFlight--;
      }
    });

    const d = new PushDispatcher({ concurrency: CAP });
    await d.dispatchToUser(userId, {
      id: "cap",
      projectId,
      username: "u",
      text: "hi",
      tweetUrl: "u",
      postedAt: new Date(),
      likes: 0,
      reposts: 0,
      replies: 0,
      payload: {},
      matchedKeywords: null,
      matchedCount: 0,
      detectedAt: new Date(),
    });

    expect(maxInFlight).toBeLessThanOrEqual(CAP);
    expect(sendNotification.mock.calls.length).toBe(N);
    await prisma.pushSubscription.deleteMany({ where: { id: { in: inserted.map((s) => s.id) } } });
  });
});
