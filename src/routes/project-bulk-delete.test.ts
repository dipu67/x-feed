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
const projectIds: string[] = [];

beforeAll(async () => {
  app = createApp().listen(0);
  const u = await prisma.user.create({
    data: {
      email: `bulk-${Date.now()}@t.local`,
      passwordHash: await hashPassword("passwordpassword1"),
    },
  });
  userId = u.id;
  const { token } = await createSession(userId);
  cookie = `xfeed_session=${token}`;

  for (const index of [1, 2]) {
    const projectId = `bulk-proj-${Date.now()}-${index}`;
    projectIds.push(projectId);
    await prisma.project.create({
      data: { userId: projectId, name: `P${index}`, username: `up${Date.now()}-${index}` },
    });
    await prisma.feedItem.create({
      data: {
        id: `bulk-feed-${Date.now()}-${index}`,
        projectId,
        username: "u",
        text: "hello",
        tweetUrl: `https://x/${index}`,
        postedAt: new Date(),
        payload: { id: `bulk-feed-${Date.now()}-${index}`, text: "hello" },
      },
    });
  }
});

afterAll(async () => {
  await prisma.project.deleteMany({ where: { userId: { in: projectIds } } });
  await prisma.user.delete({ where: { id: userId } });
  await new Promise<void>((r) => app.close(() => r()));
  await prisma.$disconnect();
});

describe("POST /projects/bulk-delete", () => {
  it("deletes every listed project and cascades their feed items", async () => {
    const res = await request(app)
      .post("/projects/bulk-delete")
      .set("Cookie", cookie)
      .send({ userIds: projectIds })
      .expect(200);
    expect(res.body.deleted).toBe(projectIds.length);

    const projects = await prisma.project.findMany({
      where: { userId: { in: projectIds } },
    });
    expect(projects).toHaveLength(0);
    const items = await prisma.feedItem.findMany({
      where: { projectId: { in: projectIds } },
    });
    expect(items).toHaveLength(0);
  });

  it("rejects an empty userIds list", async () => {
    const res = await request(app)
      .post("/projects/bulk-delete")
      .set("Cookie", cookie)
      .send({ userIds: [] })
      .expect(400);
    expect(res.body.error).toBeTruthy();
  });

  it("requires a session", async () => {
    await request(app).post("/projects/bulk-delete").send({ userIds: ["x"] }).expect(401);
  });
});

describe("DELETE /feed/:id", () => {
  it("removes the feed item, then 404s on a second attempt", async () => {
    const projectId = `feed-del-${Date.now()}`;
    const itemId = `feed-del-item-${Date.now()}`;
    await prisma.project.create({
      data: { userId: projectId, name: "P", username: `uf${Date.now()}` },
    });
    await prisma.feedItem.create({
      data: {
        id: itemId,
        projectId,
        username: "u",
        text: "hello",
        tweetUrl: "https://x/1",
        postedAt: new Date(),
        payload: { id: itemId, text: "hello" },
      },
    });

    const res = await request(app)
      .delete(`/feed/${itemId}`)
      .set("Cookie", cookie)
      .expect(200);
    expect(res.body).toEqual({ deleted: true, id: itemId });

    await request(app).delete(`/feed/${itemId}`).set("Cookie", cookie).expect(404);

    const remaining = await prisma.feedItem.findMany({ where: { projectId } });
    expect(remaining).toHaveLength(0);
    await prisma.project.delete({ where: { userId: projectId } });
  });
});
