import webpush from "web-push";
import { prisma } from "../db/prisma.js";

export type PushSubscriptionInput = {
  endpoint: string;
  expirationTime: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
  userAgent: string | null;
};

type TweetPush = {
  id: string;
  title: string;
  body: string;
  icon?: string | null;
  url: string;
};

let configured = false;
let warnedMissingConfiguration = false;

function configureWebPush() {
  if (configured) return true;

  const subject = process.env.VAPID_SUBJECT;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!subject || !publicKey || !privateKey) {
    if (!warnedMissingConfiguration) {
      console.warn(
        "[push] VAPID is not configured; background push notifications are disabled",
      );
      warnedMissingConfiguration = true;
    }
    return false;
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
  return true;
}

export async function savePushSubscription(input: PushSubscriptionInput) {
  return prisma.pushSubscription.upsert({
    where: { endpoint: input.endpoint },
    create: {
      endpoint: input.endpoint,
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
      expirationTime:
        input.expirationTime === null ? null : new Date(input.expirationTime),
      userAgent: input.userAgent,
    },
    update: {
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
      expirationTime:
        input.expirationTime === null ? null : new Date(input.expirationTime),
      userAgent: input.userAgent,
    },
  });
}

export async function removePushSubscription(endpoint: string) {
  await prisma.pushSubscription.deleteMany({ where: { endpoint } });
}

function pushStatusCode(error: unknown) {
  if (!error || typeof error !== "object" || !("statusCode" in error)) {
    return undefined;
  }
  const code = (error as { statusCode?: unknown }).statusCode;
  return typeof code === "number" ? code : undefined;
}

/** Send to every opted-in device without delaying feed ingestion. */
export async function sendTweetPushNotification(tweet: TweetPush) {
  if (!configureWebPush()) return;

  const subscriptions = await prisma.pushSubscription.findMany({
    select: { endpoint: true, p256dh: true, auth: true },
  });
  const payload = JSON.stringify({
    title: tweet.title,
    body: tweet.body,
    icon: tweet.icon ?? undefined,
    tag: tweet.id,
    url: tweet.url,
  });

  await Promise.all(
    subscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          },
          payload,
          { TTL: 60 * 60 },
        );
      } catch (error) {
        const status = pushStatusCode(error);
        if (status === 404 || status === 410) {
          await removePushSubscription(subscription.endpoint);
          return;
        }
        console.error("[push] delivery failed:", error);
      }
    }),
  );
}
