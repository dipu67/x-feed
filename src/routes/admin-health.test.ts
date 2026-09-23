import { afterAll, beforeAll, describe, it, expect } from "vitest";
import { createApp } from "../server.js";
import { prisma } from "../db/prisma.js";
import { randomToken } from "../auth/tokens.js";
import request from "supertest";
import type { Server } from "node:http";

let app: Server;
let adminToken: string;

beforeAll(async () => {
  app = createApp().listen(0);
  adminToken = `admin-${randomToken()}`;
  process.env.ADMIN_TOKEN = adminToken;
});

afterAll(async () => {
  delete process.env.ADMIN_TOKEN;
  await prisma.xauthtoken.deleteMany({
    where: { username: { startsWith: "health-test-" } },
  });
  await prisma.pushSubscription.deleteMany({
    where: { endpoint: { startsWith: "https://health.test/" } },
  });
  await new Promise<void>((r) => app.close(() => r()));
  await prisma.$disconnect();
});

describe("admin health", () => {
  it("rejects unauthenticated GET /admin/health/twitter", async () => {
    await request(app).get("/admin/health/twitter").expect(401);
  });

  it("lists active X auth tokens", async () => {
    await prisma.xauthtoken.create({
      data: {
        id: `health-${Date.now()}`,
        username: `health-test-${Date.now()}`,
        authToken: `auth-${Date.now()}`,
        ct0: `ct0-${Date.now()}`,
        isActive: true,
      },
    });
    const res = await request(app)
      .get("/admin/health/twitter")
      .set("x-admin-token", adminToken)
      .expect(200);
    const usernames = (res.body.accounts as Array<{ username: string }>).map(
      (a) => a.username,
    );
    expect(usernames.some((u) => u.startsWith("health-test-"))).toBe(true);
  });

  it("rejects unauthenticated GET /admin/health/push", async () => {
    await request(app).get("/admin/health/push").expect(401);
  });

  it("counts push subscriptions and the with-user subset", async () => {
    const user = await prisma.user.create({
      data: {
        email: `health-push-${Date.now()}@test.local`,
        passwordHash: "x",
      },
    });
    await prisma.pushSubscription.create({
      data: {
        endpoint: `https://health.test/${Date.now()}-1`,
        p256dh: "p",
        auth: "a",
        userId: user.id,
      },
    });
    await prisma.pushSubscription.create({
      data: {
        endpoint: `https://health.test/${Date.now()}-2`,
        p256dh: "p",
        auth: "a",
      },
    });
    const res = await request(app)
      .get("/admin/health/push")
      .set("x-admin-token", adminToken)
      .expect(200);
    expect(res.body.total).toBeGreaterThanOrEqual(2);
    expect(res.body.withUser).toBeGreaterThanOrEqual(1);
    await prisma.user.delete({ where: { id: user.id } });
  });
});
