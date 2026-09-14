import { Router } from "express";
import {
  removePushSubscription,
  savePushSubscription,
  type PushSubscriptionInput,
} from "../services/push.js";

export const pushRouter = Router();

function readSubscription(body: unknown): PushSubscriptionInput | null {
  if (!body || typeof body !== "object") return null;
  const value = body as Record<string, unknown>;
  const keys = value.keys;
  if (!keys || typeof keys !== "object") return null;
  const keyValues = keys as Record<string, unknown>;

  if (
    typeof value.endpoint !== "string" ||
    value.endpoint.length === 0 ||
    typeof keyValues.p256dh !== "string" ||
    keyValues.p256dh.length === 0 ||
    typeof keyValues.auth !== "string" ||
    keyValues.auth.length === 0
  ) {
    return null;
  }

  const expirationTime =
    typeof value.expirationTime === "number" &&
    Number.isFinite(value.expirationTime) &&
    value.expirationTime > 0
      ? value.expirationTime
      : null;

  return {
    endpoint: value.endpoint,
    expirationTime,
    keys: { p256dh: keyValues.p256dh, auth: keyValues.auth },
    userAgent:
      typeof value.userAgent === "string" ? value.userAgent.slice(0, 512) : null,
  };
}

pushRouter.post("/subscriptions", async (req, res) => {
  try {
    const subscription = readSubscription(req.body);
    if (!subscription) {
      res.status(400).json({ error: "Invalid push subscription" });
      return;
    }

    await savePushSubscription(subscription);
    res.status(201).json({ subscribed: true });
  } catch (error) {
    console.error("[push] failed to save subscription:", error);
    res.status(500).json({ error: "Failed to save push subscription" });
  }
});

pushRouter.delete("/subscriptions", async (req, res) => {
  try {
    const endpoint =
      req.body && typeof req.body === "object" &&
      typeof (req.body as Record<string, unknown>).endpoint === "string"
        ? (req.body as Record<string, string>).endpoint
        : null;
    if (!endpoint) {
      res.status(400).json({ error: "Push subscription endpoint is required" });
      return;
    }

    await removePushSubscription(endpoint);
    res.json({ unsubscribed: true });
  } catch (error) {
    console.error("[push] failed to remove subscription:", error);
    res.status(500).json({ error: "Failed to remove push subscription" });
  }
});
