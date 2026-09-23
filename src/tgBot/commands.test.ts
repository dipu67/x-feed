import { afterAll, beforeAll, beforeEach, describe, it, expect } from "vitest";
import { prisma } from "../db/prisma.js";
import { randomToken, sha256Hex } from "../auth/tokens.js";
import {
  handleLinkCommand,
  handleWhoamiCommand,
} from "./commands.js";

const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

let inviterId: string;
let inviteToken: string;
const chatId = 1234567;

beforeAll(async () => {
  const u = await prisma.user.create({
    data: {
      email: `tg-bot-inviter-${Date.now()}@test.local`,
      passwordHash: "x",
    },
  });
  inviterId = u.id;
});

beforeEach(async () => {
  // Clean any prior bindings from a previous test so each case starts fresh.
  await prisma.telegramBinding.deleteMany({ where: { chatId: BigInt(chatId) } });
  // Fresh invite per test.
  inviteToken = randomToken();
  await prisma.userInvite.deleteMany({ where: { invitedById: inviterId } });
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
  await prisma.user.deleteMany({ where: { id: inviterId } });
  await prisma.$disconnect();
});

describe("handleLinkCommand", () => {
  it("links the chat to the inviter when the token is valid", async () => {
    const result = await handleLinkCommand(chatId, inviteToken);
    expect(result).toEqual({ ok: true });
    const binding = await prisma.telegramBinding.findUnique({
      where: { chatId: BigInt(chatId) },
    });
    expect(binding?.userId).toBe(inviterId);
  });

  it("returns invalid when the token does not exist", async () => {
    const result = await handleLinkCommand(chatId, "no-such-token");
    expect(result).toEqual({ ok: false, reason: "invalid" });
  });

  it("returns invalid when the invite has already been accepted", async () => {
    await prisma.userInvite.updateMany({
      where: { invitedById: inviterId },
      data: { acceptedAt: new Date() },
    });
    const result = await handleLinkCommand(chatId, inviteToken);
    expect(result).toEqual({ ok: false, reason: "invalid" });
  });

  it("returns invalid when the invite has expired", async () => {
    await prisma.userInvite.updateMany({
      where: { invitedById: inviterId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const result = await handleLinkCommand(chatId, inviteToken);
    expect(result).toEqual({ ok: false, reason: "invalid" });
  });

  it("re-links an existing binding to a fresh user without losing the row", async () => {
    await handleLinkCommand(chatId, inviteToken);
    const secondInviter = await prisma.user.create({
      data: {
        email: `tg-bot-second-${Date.now()}@test.local`,
        passwordHash: "x",
      },
    });
    const secondToken = randomToken();
    await prisma.userInvite.create({
      data: {
        tokenHash: sha256Hex(secondToken),
        invitedById: secondInviter.id,
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      },
    });
    const result = await handleLinkCommand(chatId, secondToken);
    expect(result).toEqual({ ok: true });
    const binding = await prisma.telegramBinding.findUnique({
      where: { chatId: BigInt(chatId) },
    });
    expect(binding?.userId).toBe(secondInviter.id);
    // second inviter is created in this case — clean up (invite first because
    // UserInvite.invitedById FK points at the user)
    await prisma.userInvite.deleteMany({ where: { invitedById: secondInviter.id } });
    await prisma.user.delete({ where: { id: secondInviter.id } });
  });

  it("marks the invite as accepted when the link succeeds", async () => {
    const before = await prisma.userInvite.findFirst({
      where: { invitedById: inviterId, acceptedAt: null },
    });
    expect(before).not.toBeNull();
    await handleLinkCommand(chatId, inviteToken);
    const after = await prisma.userInvite.findUniqueOrThrow({
      where: { id: before!.id },
    });
    expect(after.acceptedAt).toBeInstanceOf(Date);
  });
});

describe("handleWhoamiCommand", () => {
  it("returns linked status with the user's email when bound", async () => {
    await handleLinkCommand(chatId, inviteToken);
    const result = await handleWhoamiCommand(chatId);
    expect(result.kind).toBe("linked");
    if (result.kind === "linked") {
      expect(result.email).toMatch(/^tg-bot-inviter-/);
    }
  });

  it("returns unlinked when there is no binding for the chat", async () => {
    const result = await handleWhoamiCommand(chatId);
    expect(result).toEqual({ kind: "unlinked" });
  });
});
