import { afterAll, beforeAll, describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../server.js";
import { prisma } from "../db/prisma.js";
import { hashPassword } from "../auth/password.js";
import { createSession } from "../auth/sessions.js";
import type { Server } from "node:http";

let app: Server;
let userId: string;
let projectId: string;
let cookie: string;

beforeAll(async () => {
  app = createApp().listen(0);
  const u = await prisma.user.create({
    data: {
      email: `feed-${Date.now()}@t.local`,
      passwordHash: await hashPassword("passwordpassword1"),
    },
  });
  userId = u.id;
  const { token } = await createSession(userId);
  cookie = `xfeed_session=${token}`;
  const p = await prisma.project.create({
    data: { userId: `proj-${Date.now()}`, name: "P", username: `up${Date.now()}` },
  });
  projectId = p.userId;
  await prisma.feedItem.create({
    data: {
      id: `f-${Date.now()}-1`,
      projectId,
      username: "u",
      text: "spam hello",
      tweetUrl: "https://x/1",
      postedAt: new Date(),
      payload: { id: "f-${Date.now()}-1", text: "spam hello" },
    },
  });
  await prisma.userFollow.create({ data: { userId, projectId } });
  await prisma.muteKeyword.create({ data: { userId, pattern: "spam" } });
});

afterAll(async () => {
  await prisma.feedItem.deleteMany({ where: { projectId } });
  await prisma.userFollow.deleteMany({ where: { userId } });
  await prisma.muteKeyword.deleteMany({ where: { userId } });
  await prisma.project.deleteMany({ where: { userId: projectId } });
  await prisma.user.delete({ where: { id: userId } });
  await new Promise<void>((r) => app.close(() => r()));
  await prisma.$disconnect();
});

describe("GET /feed?filter=mine", () => {
  it("applies follows + mutes (Review Focus #1 + #2)", async () => {
    const res = await request(app)
      .get("/feed?filter=mine")
      .set("Cookie", cookie)
      .expect(200);
    const body = res.body as { items?: unknown[] } | unknown[];
    const items = Array.isArray(body) ? body : body.items ?? [];
    expect(items).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ text: "spam hello" })]),
    );
  });
});
