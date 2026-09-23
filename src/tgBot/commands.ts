import { prisma } from "../db/prisma.js";
import { sha256Hex } from "../auth/tokens.js";

export type LinkResult = { ok: true } | { ok: false; reason: "invalid" };
export type WhoamiResult =
  | { kind: "linked"; email: string }
  | { kind: "unlinked" };

/**
 * Validate an invite token and (if valid) bind the Telegram chat to the
 * inviter. Re-using a chat rebinds to the latest valid invite.
 */
export async function handleLinkCommand(
  chatId: number,
  token: string,
): Promise<LinkResult> {
  const invite = await prisma.userInvite.findUnique({
    where: { tokenHash: sha256Hex(token) },
  });
  if (
    !invite ||
    invite.expiresAt.getTime() < Date.now() ||
    invite.acceptedAt
  ) {
    return { ok: false, reason: "invalid" };
  }
  await prisma.telegramBinding.upsert({
    where: { chatId: BigInt(chatId) },
    create: { chatId: BigInt(chatId), userId: invite.invitedById },
    update: { userId: invite.invitedById },
  });
  return { ok: true };
}

/**
 * Look up the user this chat is bound to. Used by the bot to reply with the
 * email of the bound account (or "unlinked").
 */
export async function handleWhoamiCommand(chatId: number): Promise<WhoamiResult> {
  const binding = await prisma.telegramBinding.findUnique({
    where: { chatId: BigInt(chatId) },
  });
  if (!binding) return { kind: "unlinked" };
  const user = await prisma.user.findUnique({ where: { id: binding.userId } });
  if (!user) return { kind: "unlinked" };
  return { kind: "linked", email: user.email };
}

export type MutateResult =
  | { ok: true }
  | { ok: false; reason: "not_linked" | "no_project" | "invalid_regex" };

async function requireBinding(chatId: number): Promise<
  | { ok: true; userId: string }
  | { ok: false; reason: "not_linked" }
> {
  const binding = await prisma.telegramBinding.findUnique({
    where: { chatId: BigInt(chatId) },
  });
  if (!binding) return { ok: false, reason: "not_linked" };
  return { ok: true, userId: binding.userId };
}

/**
 * Add a follow for the bound user. Idempotent — re-following is a no-op.
 */
export async function handleFollowCommand(
  chatId: number,
  username: string,
): Promise<MutateResult> {
  const binding = await requireBinding(chatId);
  if (!binding.ok) return binding;
  const project = await prisma.project.findUnique({ where: { username } });
  if (!project) return { ok: false, reason: "no_project" };
  await prisma.userFollow.upsert({
    where: {
      userId_projectId: { userId: binding.userId, projectId: project.userId },
    },
    create: { userId: binding.userId, projectId: project.userId },
    update: {},
  });
  return { ok: true };
}

/**
 * Remove a follow for the bound user. Idempotent — unfollowing something
 * not followed is a no-op success.
 */
export async function handleUnfollowCommand(
  chatId: number,
  username: string,
): Promise<MutateResult> {
  const binding = await requireBinding(chatId);
  if (!binding.ok) return binding;
  const project = await prisma.project.findUnique({ where: { username } });
  if (!project) return { ok: false, reason: "no_project" };
  await prisma.userFollow.deleteMany({
    where: { userId: binding.userId, projectId: project.userId },
  });
  return { ok: true };
}

/**
 * Add a mute keyword for the bound user. `isRegex=true` patterns must
 * compile as a JavaScript RegExp.
 */
export async function handleMuteCommand(
  chatId: number,
  pattern: string,
  isRegex: boolean,
): Promise<MutateResult> {
  const binding = await requireBinding(chatId);
  if (!binding.ok) return binding;
  if (isRegex) {
    try {
      new RegExp(pattern);
    } catch {
      return { ok: false, reason: "invalid_regex" };
    }
  }
  await prisma.muteKeyword.create({
    data: { userId: binding.userId, pattern, isRegex },
  });
  return { ok: true };
}

/**
 * Remove every mute keyword on the bound user that matches the given pattern
 * exactly. (Pattern equality, not regex — a mute is identified by the same
 * string the user typed.)
 */
export async function handleUnmuteCommand(
  chatId: number,
  pattern: string,
): Promise<MutateResult> {
  const binding = await requireBinding(chatId);
  if (!binding.ok) return binding;
  await prisma.muteKeyword.deleteMany({
    where: { userId: binding.userId, pattern },
  });
  return { ok: true };
}
