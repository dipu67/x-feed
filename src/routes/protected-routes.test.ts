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

beforeAll(async () => {
  app = createApp().listen(0);
  const u = await prisma.user.create({
    data: {
      email: `protected-${Date.now()}@t.local`,
      passwordHash: await hashPassword("passwordpassword1"),
    },
  });
  userId = u.id;
  const { token } = await createSession(userId);
  cookie = `xfeed_session=${token}`;
});

afterAll(async () => {
  await prisma.user.delete({ where: { id: userId } });
  await new Promise<void>((r) => app.close(() => r()));
  await prisma.$disconnect();
});

describe("authenticated-only endpoints", () => {
  it("rejects anonymous requests", async () => {
    await request(app).get("/projects").expect(401);
    await request(app).get("/auth-tokens").expect(401);
    await request(app).get("/growth").expect(401);
    await request(app).get("/feed").expect(401);
    await request(app)
      .delete("/push/subscriptions")
      .set("Content-Type", "application/json")
      .send({ endpoint: "https://push.example/1" })
      .expect(401);
  });

  it("allows requests with a session cookie", async () => {
    await request(app).get("/projects").set("Cookie", cookie).expect(200);
    await request(app).get("/auth-tokens").set("Cookie", cookie).expect(200);
    await request(app).get("/growth").set("Cookie", cookie).expect(200);
    await request(app).get("/feed").set("Cookie", cookie).expect(200);
  });

  it("DELETE /push/subscriptions only reaches removal when authed", async () => {
    await request(app)
      .delete("/push/subscriptions")
      .set("Cookie", cookie)
      .set("Content-Type", "application/json")
      .send({ endpoint: "https://push.example/nothing" })
      .expect(200)
      .expect({ unsubscribed: true });
  });
});
