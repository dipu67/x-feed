import { afterAll, beforeAll, describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../server.js";
import { prisma } from "../db/prisma.js";
import { hashPassword } from "../auth/password.js";
import { createSession } from "../auth/sessions.js";
import { hourBucketStart, dayBucketStart } from "../lib/bucket.js";
import type { Server } from "node:http";

let app: Server;
let userId: string;
let cookie: string;
const projectId = `growth-route-${Date.now()}`;

beforeAll(async () => {
  app = createApp().listen(0);
  const u = await prisma.user.create({
    data: {
      email: `growth-route-${Date.now()}@t.local`,
      passwordHash: await hashPassword("passwordpassword1"),
    },
  });
  userId = u.id;
  const { token } = await createSession(userId);
  cookie = `xfeed_session=${token}`;

  await prisma.project.create({
    data: { userId: projectId, name: "G", username: "growthroutetest" },
  });
  const now = Date.now();
  const HOUR = 60 * 60 * 1000;
  // Baseline bucket 30h ago (inside the 24h window's "before"), plus a
  // recent one that must NOT be used as the 24h baseline.
  await prisma.projectMetricRollup.create({
    data: {
      projectId,
      granularity: "hour",
      bucketStart: hourBucketStart(new Date(now - 30 * HOUR)),
      followers: 1000,
      following: 500,
      tweets: 100,
    },
  });
  await prisma.projectMetricRollup.create({
    data: {
      projectId,
      granularity: "hour",
      bucketStart: hourBucketStart(new Date(now - 2 * HOUR)),
      followers: 1100,
      following: 505,
      tweets: 103,
    },
  });
  await prisma.projectMetricRollup.create({
    data: {
      projectId,
      granularity: "day",
      bucketStart: dayBucketStart(new Date(now - 3 * 24 * HOUR)),
      followers: 900,
      following: 490,
      tweets: 90,
    },
  });
  // Mirror the baseline onto the Project row as "current" values.
  await prisma.project.update({
    where: { userId: projectId },
    data: { followers: 1100, following: 505, tweets: 103 },
  });
});

afterAll(async () => {
  await prisma.projectMetricRollup.deleteMany({
    where: { projectId: { startsWith: "growth-route-" } },
  });
  await prisma.project.deleteMany({
    where: { userId: { startsWith: "growth-route-" } },
  });
  await prisma.user.deleteMany({
    where: { email: { startsWith: "growth-route-" } },
  });
  await new Promise<void>((r) => app.close(() => r()));
  await prisma.$disconnect();
});

describe("GET /growth baselines from rollups", () => {
  it("uses the newest hourly bucket at-or-before the window start", async () => {
    const res = await request(app)
      .get("/growth?range=24h")
      .set("Cookie", cookie)
      .expect(200);
    const row = res.body.users.find(
      (u: { userId: string }) => u.userId === projectId,
    );
    expect(row).toBeDefined();
    // Baseline is the 30h-ago bucket (1000), not the 2h-ago one (1100).
    expect(row.followersDelta).toBe(100);
  });

  it("range=all uses the earliest daily bucket", async () => {
    const res = await request(app)
      .get("/growth?range=all")
      .set("Cookie", cookie)
      .expect(200);
    const row = res.body.users.find(
      (u: { userId: string }) => u.userId === projectId,
    );
    // Earliest daily bucket (900) is the all-time baseline.
    expect(row.followersDelta).toBe(200);
  });
});

describe("GET /growth/trend", () => {
  it("401 for anonymous requests", async () => {
    await request(app)
      .get(`/growth/trend?userId=${projectId}&range=24h`)
      .expect(401);
  });

  it("24h and 7d read hourly buckets, 30d reads daily", async () => {
    const hourly = await request(app)
      .get(`/growth/trend?userId=${projectId}&range=7d`)
      .set("Cookie", cookie)
      .expect(200);
    expect(hourly.body.range).toBe("7d");
    const hPoints = hourly.body.points as Array<{
      t: string;
      followers: number;
    }>;
    expect(hPoints.length).toBe(2); // the two hourly buckets
    expect(hPoints[0]!.followers).toBe(1000); // ascending order
    expect(hPoints[1]!.followers).toBe(1100);

    const daily = await request(app)
      .get(`/growth/trend?userId=${projectId}&range=30d`)
      .set("Cookie", cookie)
      .expect(200);
    const dPoints = daily.body.points as Array<{ followers: number }>;
    expect(dPoints.length).toBe(1); // only the daily bucket
    expect(dPoints[0]!.followers).toBe(900);
  });

  it("400 without userId", async () => {
    await request(app).get("/growth/trend").set("Cookie", cookie).expect(400);
  });
});
