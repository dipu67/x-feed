import { afterAll, beforeAll, describe, it, expect } from "vitest";
import { createApp } from "../server.js";
import { prisma } from "../db/prisma.js";
import { randomToken, sha256Hex } from "../auth/tokens.js";
import request from "supertest";
import type { Server } from "node:http";

let app: Server;
let inviteToken: string;

beforeAll(async () => {
  app = createApp().listen(0);
  const admin = await prisma.user.create({
    data: { email: `accept-admin-${Date.now()}@t.local`, passwordHash: "x" },
  });
  const token = randomToken();
  const invite = await prisma.userInvite.create({
    data: {
      tokenHash: sha256Hex(token),
      invitedById: admin.id,
      email: `accept-${Date.now()}@t.local`,
      expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
    },
  });
  inviteToken = token;
  void invite;
});

afterAll(async () => {
  await prisma.userInvite.deleteMany({});
  await prisma.user.deleteMany({ where: { email: { startsWith: "accept-" } } });
  await new Promise<void>((r) => app.close(() => r()));
  await prisma.$disconnect();
});

describe("POST /auth/accept-invite", () => {
  it("creates a user + session", async () => {
    const res = await request(app)
      .post("/auth/accept-invite")
      .send({ token: inviteToken, password: "Abcdef1!Abcdef1!" })
      .expect(200);
    expect(res.body.email).toMatch(/^accept-/);
    expect(res.headers["set-cookie"]?.[0]).toMatch(/^xfeed_session=/);
  });

  it("rejects an expired token", async () => {
    const t = randomToken();
    const admin = await prisma.user.findFirst({ where: { email: { startsWith: "accept-admin-" } } });
    await prisma.userInvite.create({
      data: {
        tokenHash: sha256Hex(t),
        invitedById: admin!.id,
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    await request(app)
      .post("/auth/accept-invite")
      .send({ token: t, password: "Abcdef1!Abcdef1!" })
      .expect(410);
  });

  it("rejects token reuse", async () => {
    await request(app)
      .post("/auth/accept-invite")
      .send({ token: inviteToken, password: "Abcdef1!Abcdef1!" })
      .expect(410);
  });

  it("two concurrent accepts of the same token produce exactly one user", async () => {
    // The race: without an atomic transaction, both requests can read
    // acceptedAt=null, both create users, then race the invite update. We
    // expect exactly one 200 + one 410, and exactly one new user row tied to
    // the invite.
    const t = randomToken();
    const admin = await prisma.user.findFirst({ where: { email: { startsWith: "accept-admin-" } } });
    const invite = await prisma.userInvite.create({
      data: {
        tokenHash: sha256Hex(t),
        invitedById: admin!.id,
        expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      },
    });
    const [r1, r2] = await Promise.all([
      request(app).post("/auth/accept-invite").send({ token: t, password: "Abcdef1!Abcdef1!" }),
      request(app).post("/auth/accept-invite").send({ token: t, password: "Abcdef1!Abcdef1!" }),
    ]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([200, 410]);
    // Exactly one user should be linked to this invite
    const linked = await prisma.userInvite.count({ where: { id: invite.id, acceptedById: { not: null } } });
    expect(linked).toBe(1);
  });
});
