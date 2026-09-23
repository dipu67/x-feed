import { Bot } from "grammy";
import {
  handleLinkCommand,
  handleWhoamiCommand,
  handleFollowCommand,
  handleUnfollowCommand,
  handleMuteCommand,
  handleUnmuteCommand,
} from "./commands.js";

const token = process.env.TELEGRAM_BOT_TOKEN ?? "";
export const bot = new Bot(token);

/**
 * /link <invite-or-login-token>
 * Binds the chat to the inviter referenced by the invite token.
 */
bot.command("link", async (ctx) => {
  const parts = ctx.message?.text?.split(/\s+/) ?? [];
  const inviteToken = parts[1];
  if (!inviteToken) {
    await ctx.reply("Usage: /link <token>");
    return;
  }
  const chatId = ctx.chat?.id;
  if (typeof chatId !== "number") {
    await ctx.reply("This command only works in chats, not private messages.");
    return;
  }
  const result = await handleLinkCommand(chatId, inviteToken);
  if (result.ok) {
    await ctx.reply("Linked.");
    return;
  }
  await ctx.reply("Invalid or expired link token.");
});

/**
 * /whoami
 * Replies with the email bound to this chat, or a hint to /link.
 */
bot.command("whoami", async (ctx) => {
  const chatId = ctx.chat?.id;
  if (typeof chatId !== "number") {
    await ctx.reply("This command only works in chats.");
    return;
  }
  const result = await handleWhoamiCommand(chatId);
  if (result.kind === "linked") {
    await ctx.reply(`Linked as ${result.email}`);
    return;
  }
  await ctx.reply("Not linked. Use /link <token>.");
});

bot.command("follow", async (ctx) => {
  const username = ctx.message?.text?.split(/\s+/)[1];
  if (!username) {
    await ctx.reply("Usage: /follow <username>");
    return;
  }
  const chatId = ctx.chat?.id;
  if (typeof chatId !== "number") {
    await ctx.reply("This command only works in chats.");
    return;
  }
  const result = await handleFollowCommand(chatId, username);
  if (result.ok) {
    await ctx.reply(`Following @${username}.`);
    return;
  }
  await ctx.reply(replyFor(result.reason));
});

bot.command("unfollow", async (ctx) => {
  const username = ctx.message?.text?.split(/\s+/)[1];
  if (!username) {
    await ctx.reply("Usage: /unfollow <username>");
    return;
  }
  const chatId = ctx.chat?.id;
  if (typeof chatId !== "number") {
    await ctx.reply("This command only works in chats.");
    return;
  }
  const result = await handleUnfollowCommand(chatId, username);
  if (result.ok) {
    await ctx.reply(`Unfollowed @${username}.`);
    return;
  }
  await ctx.reply(replyFor(result.reason));
});

bot.command("mute", async (ctx) => {
  const parts = ctx.message?.text?.split(/\s+/) ?? [];
  const pattern = parts[1];
  if (!pattern) {
    await ctx.reply("Usage: /mute <pattern> [--regex]");
    return;
  }
  const isRegex = parts.includes("--regex");
  const chatId = ctx.chat?.id;
  if (typeof chatId !== "number") {
    await ctx.reply("This command only works in chats.");
    return;
  }
  const result = await handleMuteCommand(chatId, pattern, isRegex);
  if (result.ok) {
    await ctx.reply(`Muting ${isRegex ? "regex" : "literal"}: ${pattern}`);
    return;
  }
  await ctx.reply(replyFor(result.reason));
});

bot.command("unmute", async (ctx) => {
  const pattern = ctx.message?.text?.split(/\s+/)[1];
  if (!pattern) {
    await ctx.reply("Usage: /unmute <pattern>");
    return;
  }
  const chatId = ctx.chat?.id;
  if (typeof chatId !== "number") {
    await ctx.reply("This command only works in chats.");
    return;
  }
  const result = await handleUnmuteCommand(chatId, pattern);
  if (result.ok) {
    await ctx.reply(`Unmuted: ${pattern}`);
    return;
  }
  await ctx.reply(replyFor(result.reason));
});

function replyFor(reason: string): string {
  switch (reason) {
    case "not_linked":
      return "Not linked. Use /link <token> first.";
    case "no_project":
      return "Project not found.";
    case "invalid_regex":
      return "Invalid regex.";
    default:
      return `Failed: ${reason}`;
  }
}
