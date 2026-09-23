import { afterAll, beforeAll, describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../server.js";
import { prisma } from "../db/prisma.js";
import { randomToken } from "../auth/tokens.js";
import type { Server } from "node:http";

let app: Server;
let adminToken: string;
let userId: string;
let xauthId: string;

beforeAll(async () => {
  app = createApp().listen(0);
  adminToken = `admin-${randomToken()}`;
  process.env.ADMIN_TOKEN = adminToken;

  const u = await prisma.user.create({
    data: { email: `xauth-${Date.now()}@test.local`, passwordHash: "x" },
  });
  userId = u.id;

  const x = await prisma.xauthtoken.create({
    data: {
      id: `xauth-${Date.now()}`,
      username: `xtu${Date.now()}`,
      authToken: `at-${Date.now()}`,
      ct0: `ct0-${Date.now()}`,
      isActive: true,
    },
  });
  xauthId = x.id;
});

afterAll(async () => {
  await prisma.xauthtoken.deleteMany({ where: { id: xauthId } });
  await prisma.user.delete({ where: { id: userId } });
  await new Promise<void>((r) => app.close(() => r()));
  delete process.env.ADMIN_TOKEN;
  await prisma.$disconnect();
});

describe("admin xauth link/unlink", () => {
  it("rejects unauthenticated POST /admin/users/:userId/link-x", async () => {
    await request(app)
      .post(`/admin/users/${userId}/link-x`)
      .send({ xauthtokenId: xauthId })
      .expect(401);
  });

  it("links an xauthtoken to a user", async () => {
    await request(app)
      .post(`/admin/users/${userId}/link-x`)
      .set("x-admin-token", adminToken)
      .send({ xauthtokenId: xauthId })
      .expect(200);
    const row = await prisma.xauthtoken.findUnique({ where: { id: xauthId } });
    expect(row?.userId).toBe(userId);
  });

  it("unlinks an xauthtoken from a user", async () => {
    await request(app)
      .delete(`/admin/users/${userId}/link-x/${xauthId}`)
      .set("x-admin-token", adminToken)
      .expect(200);
    const row = await prisma.xauthtoken.findUnique({ where: { id: xauthId } });
    expect(row?.userId).toBeNull();
  });
});
