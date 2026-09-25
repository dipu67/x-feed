import { afterAll, beforeAll, beforeEach, describe, it, expect } from "vitest";
import { prisma } from "../db/prisma.js";
import { randomToken, sha256Hex } from "../auth/tokens.js";
import {
  handleFollowCommand,
  handleUnfollowCommand,
  handleMuteCommand,
  handleUnmuteCommand,
} from "./commands.js";

const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const chatId = 7777777;

let inviterId: string;
let inviteToken: string;
const projectIds: string[] = [];

beforeAll(async () => {
  const u = await prisma.user.create({
    data: {
      email: `tg-follow-inviter-${Date.now()}@test.local`,
      passwordHash: "x",
    },
  });
  inviterId = u.id;
  const project = await prisma.project.create({
    data: {
      userId: `tg-follow-proj-${Date.now()}`,
      name: "Test Project",
      username: `tgfollowproj${Date.now().toString().slice(-7)}`,
    },
  });
  projectIds.push(project.userId);
});

beforeEach(async () => {
  await prisma.telegramBinding.deleteMany({ where: { chatId: BigInt(chatId) } });
  await prisma.userInvite.deleteMany({ where: { invitedById: inviterId } });
  await prisma.userFollow.deleteMany({ where: { userId: inviterId } });
  await prisma.muteKeyword.deleteMany({ where: { userId: inviterId } });
  inviteToken = randomToken();
  await prisma.userInvite.create({
    data: {
      tokenHash: sha256Hex(inviteToken),
      invitedById: inviterId,
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
    },
  });
});

afterAll(async () => {
  await prisma.userInvite.deleteMany({ where: { invitedById: inviterId } });
  await prisma.telegramBinding.deleteMany({ where: { chatId: BigInt(chatId) } });
  await prisma.userFollow.deleteMany({ where: { userId: inviterId } });
  await prisma.muteKeyword.deleteMany({ where: { userId: inviterId } });
  await prisma.user.delete({ where: { id: inviterId } });
  await prisma.project.deleteMany({ where: { userId: { in: projectIds } } });
  await prisma.$disconnect();
});

async function linkChat(): Promise<void> {
  await prisma.telegramBinding.create({
    data: { chatId: BigInt(chatId), userId: inviterId },
  });
}

async function projectUsername(): Promise<string> {
  const p = await prisma.project.findUniqueOrThrow({ where: { userId: projectIds[0]! } });
  return p.username;
}

describe("handleFollowCommand", () => {
  it("returns not_linked when there is no binding", async () => {
    const result = await handleFollowCommand(chatId, await projectUsername());
    expect(result).toEqual({ ok: false, reason: "not_linked" });
  });

  it("returns no_project when the project does not exist", async () => {
    await linkChat();
    const result = await handleFollowCommand(chatId, "no-such-username");
    expect(result).toEqual({ ok: false, reason: "no_project" });
  });

  it("creates a follow when both binding and project exist", async () => {
    await linkChat();
    const username = await projectUsername();
    const result = await handleFollowCommand(chatId, username);
    expect(result).toEqual({ ok: true });
    const follows = await prisma.userFollow.findMany({
      where: { userId: inviterId, projectId: projectIds[0]! },
    });
    expect(follows).toHaveLength(1);
  });
});

describe("handleUnfollowCommand", () => {
  it("returns not_linked when there is no binding", async () => {
    const result = await handleUnfollowCommand(chatId, await projectUsername());
    expect(result).toEqual({ ok: false, reason: "not_linked" });
  });

  it("removes an existing follow", async () => {
    await linkChat();
    const username = await projectUsername();
    await handleFollowCommand(chatId, username);
    const result = await handleUnfollowCommand(chatId, username);
    expect(result).toEqual({ ok: true });
    const follows = await prisma.userFollow.findMany({
      where: { userId: inviterId, projectId: projectIds[0]! },
    });
    expect(follows).toHaveLength(0);
  });
});

describe("handleMuteCommand", () => {
  it("returns not_linked when there is no binding", async () => {
    const result = await handleMuteCommand(chatId, "spam", false);
    expect(result).toEqual({ ok: false, reason: "not_linked" });
  });

  it("returns invalid_regex when the regex is malformed", async () => {
    await linkChat();
    const result = await handleMuteCommand(chatId, "[unclosed", true);
    expect(result).toEqual({ ok: false, reason: "invalid_regex" });
  });

  it("creates a literal mute", async () => {
    await linkChat();
    const result = await handleMuteCommand(chatId, "spam", false);
    expect(result).toEqual({ ok: true });
    const mutes = await prisma.muteKeyword.findMany({ where: { userId: inviterId } });
    expect(mutes).toHaveLength(1);
    expect(mutes[0]?.pattern).toBe("spam");
    expect(mutes[0]?.isRegex).toBe(false);
  });

  it("creates a regex mute when the pattern compiles", async () => {
    await linkChat();
    const result = await handleMuteCommand(chatId, "sp[ae]m", true);
    expect(result).toEqual({ ok: true });
    const mutes = await prisma.muteKeyword.findMany({ where: { userId: inviterId } });
    expect(mutes).toHaveLength(1);
    expect(mutes[0]?.isRegex).toBe(true);
  });
});

describe("handleUnmuteCommand", () => {
  it("returns not_linked when there is no binding", async () => {
    const result = await handleUnmuteCommand(chatId, "spam");
    expect(result).toEqual({ ok: false, reason: "not_linked" });
  });

  it("removes mutes matching the pattern", async () => {
    await linkChat();
    await handleMuteCommand(chatId, "spam", false);
    await handleMuteCommand(chatId, "spam2", false);
    await handleMuteCommand(chatId, "other", false);
    const result = await handleUnmuteCommand(chatId, "spam");
    expect(result).toEqual({ ok: true });
    const mutes = await prisma.muteKeyword.findMany({ where: { userId: inviterId } });
    expect(mutes.map((m) => m.pattern).sort()).toEqual(["other", "spam2"]);
  });
});
