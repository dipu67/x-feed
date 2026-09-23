import { prisma } from "../db/prisma.js";
import { TwitterClient } from "../TwitterClient/index.js";

export type TwitterClientHandle = {
  client: TwitterClient;
  accountId: string;
};

export async function getTwitterClient(): Promise<TwitterClientHandle> {
  const account = await prisma.xauthtoken.findFirst({
    where: { isActive: true },
  });

  if (account) {
    return {
      accountId: account.id,
      client: new TwitterClient({
        cookies: { authToken: account.authToken, ct0: account.ct0 },
      }),
    };
  }

  const authToken = process.env.TWITTER_AUTH_TOKEN;
  const ct0 = process.env.TWITTER_CT0;
  if (authToken && ct0) {
    return {
      accountId: "env",
      client: new TwitterClient({ cookies: { authToken, ct0 } }),
    };
  }

  throw new Error(
    "No available Twitter auth accounts (all rate-limited or inactive)",
  );
}
