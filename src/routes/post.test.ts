import { afterAll, beforeAll, describe, it, expect, vi } from "vitest";
import request from "supertest";
import { createApp } from "../server.js";
import { prisma } from "../db/prisma.js";
import { hashPassword } from "../auth/password.js";
import { createSession } from "../auth/sessions.js";
import type { Server } from "node:http";

vi.mock("../twitter/XWriteClient.js", () => {
  class StubXWriteClient {
    post = vi.fn().mockResolvedValue({ ok: true, tweetId: "1", url: "https://x/1" });
    like = vi.fn().mockResolvedValue({ ok: true, tweetId: "1", url: "https://x/1" });
    retweet = vi.fn().mockResolvedValue({ ok: true, tweetId: "1", url: "https://x/1" });
    reply = vi.fn().mockResolvedValue({ ok: true, tweetId: "1", url: "https://x/1" });
  }
  return { XWriteClient: StubXWriteClient };
});

let app: Server;
let userId: string;
let cookie: string;

beforeAll(async () => {
  app = createApp().listen(0);
  const u = await prisma.user.create({
    data: {
      email: `post-${Date.now()}@t.local`,
      passwordHash: await hashPassword("passwordpassword1"),
    },
  });
  userId = u.id;
  const { token } = await createSession(userId);
  cookie = `xfeed_session=${token}`;
  await prisma.xauthtoken.create({
    data: {
      id: `xt-${Date.now()}`,
      username: `x_${Date.now()}`,
      authToken: `at-${Date.now()}`,
      ct0: `ct0-${Date.now()}`,
      userId,
    },
  });
});

afterAll(async () => {
  await prisma.xauthtoken.deleteMany({ where: { userId } });
  await prisma.user.delete({ where: { id: userId } });
  await new Promise<void>((r) => app.close(() => r()));
  await prisma.$disconnect();
});

describe("POST /post", () => {
  it("posts when X account linked", async () => {
    await request(app)
      .post("/post")
      .set("Cookie", cookie)
      .send({ text: "hi" })
      .expect(201);
  });

  it("409 when no X account linked", async () => {
    await prisma.xauthtoken.updateMany({ where: { userId }, data: { userId: null } });
    await request(app)
      .post("/post")
      .set("Cookie", cookie)
      .send({ text: "hi" })
      .expect(409);
    // restore for any later test
    await prisma.xauthtoken.updateMany({
      where: { username: { startsWith: "x_" } },
      data: { userId },
    });
  });
});
