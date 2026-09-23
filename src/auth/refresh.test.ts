import { afterAll, beforeAll, describe, it, expect } from "vitest";
import { prisma } from "../db/prisma.js";
import { createSession, refreshIfNeeded, resolveSession } from "./sessions.js";

let userId: string;

beforeAll(async () => {
  const u = await prisma.user.create({
    data: {
      email: `refresh-${Date.now()}@test.local`,
      passwordHash: "x",
    },
  });
  userId = u.id;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { startsWith: "refresh-" } } });
  await prisma.$disconnect();
});

describe("concurrent refresh", () => {
  it("10 parallel refreshIfNeeded calls produce exactly one updated expiresAt", async () => {
    const { token } = await createSession(userId);
    const resolved = await resolveSession(token);
    expect(resolved).not.toBeNull();
    if (!resolved) return;

    // Backdate so refresh triggers
    const past = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000); // 3 days
    await prisma.userSession.update({
      where: { id: resolved.session.id },
      data: { expiresAt: past },
    });
    const fresh = await resolveSession(token);
    if (!fresh) throw new Error("session vanished");

    const results = await Promise.all(
      Array.from({ length: 10 }, () => refreshIfNeeded(fresh.session)),
    );

    // All 10 calls returned the same expiresAt (no two writers race to different times).
    const timestamps = results.map((r) => r.expiresAt.getTime());
    const unique = new Set(timestamps);
    expect(unique.size).toBe(1);
  });
});
