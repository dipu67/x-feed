import { prisma } from "../db/prisma.js";
import { sha256Hex } from "../auth/tokens.js";
import { shouldShow, toFilterRule } from "../feed/filter-evaluator.js";

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
  // Mark the invite accepted — invites are single-use and shared with
  // /accept-invite on the web. Use updateMany + acceptedAt-null guard so
  // two chats racing the same token can't both bind (loser sees count=0
  // and we revert the binding we just created above).
  const claim = await prisma.userInvite.updateMany({
    where: { id: invite.id, acceptedAt: null },
    data: { acceptedAt: new Date() },
  });
  if (claim.count === 0) {
    await prisma.telegramBinding.delete({ where: { chatId: BigInt(chatId) } })
      .catch(() => undefined);
    return { ok: false, reason: "invalid" };
  }
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

export type FeedItem = { username: string; text: string; url: string };

export type FeedResult =
  | { ok: true; items: FeedItem[] }
  | { ok: false; reason: "not_linked" };

/**
 * Return the most recent feed items visible to the bound user after applying
 * their follows + filters + mutes. Capped at `n` items, but reads up to 200
 * from the DB so the cap is applied to the post-filter list, not raw rows.
 */
export async function handleFeedCommand(
  chatId: number,
  n: number,
): Promise<FeedResult> {
  const binding = await requireBinding(chatId);
  if (!binding.ok) return { ok: false, reason: "not_linked" };
  const [follows, filters, mutes] = await Promise.all([
    prisma.userFollow.findMany({ where: { userId: binding.userId } }),
    prisma.filter.findMany({
      where: { userId: binding.userId, isActive: true },
    }),
    prisma.muteKeyword.findMany({ where: { userId: binding.userId } }),
  ]);
  const followSet = new Set(follows.map((f) => f.projectId));
  const items = await prisma.feedItem.findMany({
    orderBy: { postedAt: "desc" },
    take: 200,
  });
  const filtered = items.filter((i) =>
    shouldShow(
      { projectId: i.projectId, text: i.text },
      followSet,
      filters.map(toFilterRule),
      mutes,
    ),
  );
  return {
    ok: true,
    items: filtered
      .slice(0, n)
      .map((i) => ({ username: i.username, text: i.text, url: i.tweetUrl })),
  };
}

export type FiltersResult =
  | { ok: true; filters: unknown[] }
  | { ok: false; reason: "not_linked" };

/**
 * Return every filter (active and inactive) on the bound user. The bot can
 * render the names + states directly; deeper rendering lives in the UI.
 */
export async function handleFiltersCommand(
  chatId: number,
): Promise<FiltersResult> {
  const binding = await requireBinding(chatId);
  if (!binding.ok) return { ok: false, reason: "not_linked" };
  const filters = await prisma.filter.findMany({
    where: { userId: binding.userId },
  });
  return { ok: true, filters };
}
