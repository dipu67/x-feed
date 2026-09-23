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
