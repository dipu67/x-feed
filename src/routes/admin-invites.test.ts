import { afterAll, beforeAll, beforeEach, describe, it, expect } from "vitest";
import { createApp } from "../server.js";
import { prisma } from "../db/prisma.js";
import { randomToken, sha256Hex } from "../auth/tokens.js";
import request from "supertest";
import type { Server } from "node:http";

let app: Server;
let adminToken: string;
let inviterId: string;

beforeAll(async () => {
  app = createApp().listen(0);
  adminToken = `admin-${randomToken()}`;
  process.env.ADMIN_TOKEN = adminToken;
});

afterAll(async () => {
  await prisma.userInvite.deleteMany({ where: { email: { startsWith: "invite-test-" } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: "invite-admin-" } } });
  await new Promise<void>((r) => app.close(() => r()));
  delete process.env.ADMIN_TOKEN;
  await prisma.$disconnect();
});

beforeEach(async () => {
  if (!inviterId) {
    const u = await prisma.user.create({
      data: { email: `invite-admin-${Date.now()}@test.local`, passwordHash: "x" },
    });
    inviterId = u.id;
  }
});

describe("admin invites", () => {
  it("rejects unauthenticated POST /admin/users/invites", async () => {
    await request(app).post("/admin/users/invites").send({}).expect(401);
  });

  it("creates an invite when admin token is valid", async () => {
    const res = await request(app)
      .post("/admin/users/invites")
      .set("x-admin-token", adminToken)
      .send({ invitedById: inviterId, email: `invite-test-${Date.now()}@x.local` })
      .expect(201);
    expect(res.body.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(res.body.expiresAt).toBeDefined();
  });

  it("rejects invite with unknown invitedById", async () => {
    await request(app)
      .post("/admin/users/invites")
      .set("x-admin-token", adminToken)
      .send({ invitedById: "missing-user", email: "x@y.local" })
      .expect(400);
  });
});
