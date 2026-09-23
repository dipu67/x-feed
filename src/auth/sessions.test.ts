import { afterAll, beforeAll, describe, it, expect } from "vitest";
import { prisma } from "../db/prisma.js";
import { createSession, resolveSession, revokeSession } from "./sessions.js";

let userId: string;

beforeAll(async () => {
  const u = await prisma.user.create({
    data: {
      email: `sessions-${Date.now()}@test.local`,
      passwordHash: "x",
    },
  });
  userId = u.id;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { startsWith: "sessions-" } } });
  await prisma.$disconnect();
});

describe("sessions", () => {
  it("create then resolve returns the user", async () => {
    const { token } = await createSession(userId);
    const result = await resolveSession(token);
    expect(result?.user.id).toBe(userId);
  });

  it("revokeSession makes resolveSession return null", async () => {
    const { token } = await createSession(userId);
    await revokeSession(token);
    expect(await resolveSession(token)).toBeNull();
  });

  it("resolveSession returns null for an unknown token", async () => {
    expect(await resolveSession("does-not-exist")).toBeNull();
  });
});
