import { Bot } from "grammy";

export type TelegramAlert = {
  label: string;
  username: string;
  text: string;
  url: string;
};

let bot: Bot | null = null;
let warnedMissingConfiguration = false;

function getBot(): Bot | null {
  if (bot) return bot;
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    if (!warnedMissingConfiguration) {
      console.warn(
        "[telegram] TELEGRAM_BOT_TOKEN is not set; telegram alerts are disabled",
      );
      warnedMissingConfiguration = true;
    }
    return null;
  }
  bot = new Bot(token);
  return bot;
}

/** Fire-and-forget alert sender; failures are logged, never thrown. */
export async function sendTelegramAlert(alert: TelegramAlert): Promise<boolean> {
  const activeBot = getBot();
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!activeBot || !chatId) return false;

  const text = `🚨 ${alert.label} — @${alert.username}\n\n${alert.text.slice(0, 300)}\n\n${alert.url}`;
  try {
    await activeBot.api.sendMessage(chatId, text);
    return true;
  } catch (error) {
    console.error("[telegram] delivery failed:", error);
    return false;
  }
}
