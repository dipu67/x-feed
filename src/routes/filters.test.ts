import { afterAll, beforeAll, describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../server.js";
import { prisma } from "../db/prisma.js";
import { hashPassword } from "../auth/password.js";
import { createSession } from "../auth/sessions.js";
import type { Server } from "node:http";

let app: Server;
let userId: string;
let sessionCookie: string;

beforeAll(async () => {
  app = createApp().listen(0);
  const u = await prisma.user.create({
    data: {
      email: `filters-${Date.now()}@t.local`,
      passwordHash: await hashPassword("passwordpassword1"),
    },
  });
  userId = u.id;
  const { token } = await createSession(userId);
  sessionCookie = `xfeed_session=${token}`;
});

afterAll(async () => {
  await prisma.filter.deleteMany({ where: { userId } });
  await prisma.muteKeyword.deleteMany({ where: { userId } });
  await prisma.user.delete({ where: { id: userId } });
  await new Promise<void>((r) => app.close(() => r()));
  await prisma.$disconnect();
});

describe("filters routes", () => {
  it("rejects unauthenticated", async () => {
    await request(app).get("/filters").expect(401);
  });

  it("creates and lists a filter", async () => {
    const res = await request(app)
      .post("/filters")
      .set("Cookie", sessionCookie)
      .send({ name: "Hide foo", kind: "keyword", pattern: "foo", action: "hide" })
      .expect(201);
    expect(res.body.id).toBeDefined();
    const list = await request(app).get("/filters").set("Cookie", sessionCookie).expect(200);
    expect(list.body.some((f: { id: string }) => f.id === res.body.id)).toBe(true);
  });

  it("creates a mute keyword", async () => {
    await request(app)
      .post("/mute-keywords")
      .set("Cookie", sessionCookie)
      .send({ pattern: "spam" })
      .expect(201);
  });
});
