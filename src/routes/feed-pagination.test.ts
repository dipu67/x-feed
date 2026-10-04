import { afterAll, beforeAll, describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../server.js";
import { prisma } from "../db/prisma.js";
import { hashPassword } from "../auth/password.js";
import { createSession } from "../auth/sessions.js";
import type { Server } from "node:http";

let app: Server;
let userId: string;
let cookie: string;
let projectId: string;

beforeAll(async () => {
  app = createApp().listen(0);
  const u = await prisma.user.create({
    data: {
      email: `page-${Date.now()}@t.local`,
      passwordHash: await hashPassword("passwordpassword1"),
    },
  });
  userId = u.id;
  const { token } = await createSession(userId);
  cookie = `xfeed_session=${token}`;

  projectId = `page-proj-${Date.now()}`;
  await prisma.project.create({
    data: { userId: projectId, name: "P", username: `up${Date.now()}` },
  });
  // 5 items detected a minute apart; detectedAt drives the feed ordering.
  // The feed is global, so assertions below always derive expectations from
  // the full table count instead of assuming only these rows exist.
  for (let i = 0; i < 5; i += 1) {
    await prisma.feedItem.create({
      data: {
        id: `page-item-${Date.now()}-${i}`,
        projectId,
        username: "u",
        text: `post ${i}`,
        tweetUrl: `https://x/${i}`,
        postedAt: new Date(),
        detectedAt: new Date(Date.now() - i * 60_000),
        payload: { id: `${i}` },
      },
    });
  }
});

afterAll(async () => {
  await prisma.project.delete({ where: { userId: projectId } });
  await prisma.user.delete({ where: { id: userId } });
  await new Promise<void>((r) => app.close(() => r()));
  await prisma.$disconnect();
});

const idsOf = (body: { items: Array<{ id: string }> }) =>
  body.items.map((item) => item.id);

describe("GET /feed pagination", () => {
  it("returns `limit` items with hasMore reflecting the full table", async () => {
    const total = await prisma.feedItem.count();
    const res = await request(app)
      .get("/feed?limit=2")
      .set("Cookie", cookie)
      .expect(200);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.hasMore).toBe(total > 2);
  });

  it("honors offset and pages do not overlap", async () => {
    const first = await request(app)
      .get("/feed?limit=2")
      .set("Cookie", cookie)
      .expect(200);
    const second = await request(app)
      .get("/feed?limit=2&offset=2")
      .set("Cookie", cookie)
      .expect(200);
    expect(second.body.items).toHaveLength(2);
    for (const id of idsOf(first.body)) {
      expect(idsOf(second.body)).not.toContain(id);
    }
  });

  it("reports hasMore=false on the last page", async () => {
    const total = await prisma.feedItem.count();
    const res = await request(app)
      .get(`/feed?limit=2&offset=${total - 1}`)
      .set("Cookie", cookie)
      .expect(200);
    expect(res.body.hasMore).toBe(false);
    expect(res.body.items).toHaveLength(1);
  });

  it("applies hasMore to matched-only pages", async () => {
    // Remove this project's items from the matched pool; whatever matches
    // remain come from other rows in the shared dev database.
    await prisma.feedItem.updateMany({
      where: { projectId },
      data: { matchedCount: 0 },
    });
    const matchedTotal = await prisma.feedItem.count({
      where: { matchedCount: { gt: 0 } },
    });
    const res = await request(app)
      .get("/feed?limit=2&matched=1")
      .set("Cookie", cookie)
      .expect(200);
    expect(res.body.items.every((item: { projectId: string }) => item.projectId !== projectId)).toBe(true);
    expect(res.body.hasMore).toBe(matchedTotal > 2);
  });
});
