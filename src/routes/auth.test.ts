import { afterAll, beforeAll, describe, it, expect } from "vitest";
import { createApp } from "../server.js";
import { prisma } from "../db/prisma.js";
import { hashPassword } from "../auth/password.js";
import request from "supertest";
import type { Server } from "node:http";

let app: Server;
let email: string;
let password = "CorrectHorseBatteryStaple1!";

beforeAll(async () => {
  app = createApp().listen(0);
  email = `login-${Date.now()}@test.local`;
  await prisma.user.create({
    data: { email, passwordHash: await hashPassword(password) },
  });
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email } });
  await new Promise<void>((r) => app.close(() => r()));
  await prisma.$disconnect();
});

describe("POST /auth/login", () => {
  it("sets cookie and returns user on valid creds", async () => {
    const res = await request(app)
      .post("/auth/login")
      .send({ email, password })
      .expect(200);
    expect(res.body.email).toBe(email);
    expect(res.headers["set-cookie"]?.[0]).toMatch(/^xfeed_session=/);
  });

  it("omits the Secure flag in non-production so HTTP dev can round-trip cookies", async () => {
    // Secure cookies are silently dropped by browsers on plain HTTP, which
    // breaks the dev login flow on localhost. Production must keep Secure;
    // any other environment must omit it so the cookie round-trips.
    const isProd = process.env.NODE_ENV === "production";
    const res = await request(app)
      .post("/auth/login")
      .send({ email, password })
      .expect(200);
    const setCookie = res.headers["set-cookie"]?.[0] ?? "";
    if (isProd) {
      expect(setCookie).toMatch(/;\s*Secure/i);
    } else {
      expect(setCookie).not.toMatch(/;\s*Secure/i);
    }
  });

  it("401 on bad password", async () => {
    await request(app)
      .post("/auth/login")
      .send({ email, password: "wrong" })
      .expect(401);
  });

  it("401 on unknown email", async () => {
    await request(app)
      .post("/auth/login")
      .send({ email: "nobody@test.local", password })
      .expect(401);
  });
});
