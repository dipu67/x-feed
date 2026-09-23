import { Bot } from "grammy";
import { handleLinkCommand, handleWhoamiCommand } from "./commands.js";

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
