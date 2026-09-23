import webpush from "web-push";
import { prisma } from "../db/prisma.js";
import { shouldShow } from "../feed/filter-evaluator.js";
import type { FeedItem } from "../generated/prisma/client.js";

type DispatcherOpts = { concurrency?: number };

export class PushDispatcher {
  private readonly concurrency: number;
  constructor(opts: DispatcherOpts = {}) {
    this.concurrency = opts.concurrency ?? 16;
    this.ensureVapid();
  }

  private ensureVapid(): void {
    const subject = process.env.VAPID_SUBJECT;
    const newPublic = process.env.VAPID_PUBLIC_KEY_NEW;
    const newPrivate = process.env.VAPID_PRIVATE_KEY_NEW;
    // When _NEW keys are present, prefer them. web-push keeps a single
    // global VAPID detail, so an operator must restart the server to fully
    // rotate — keep both sets documented in .env.example.
    const publicKey = newPublic ?? process.env.VAPID_PUBLIC_KEY;
    const privateKey = newPrivate ?? process.env.VAPID_PRIVATE_KEY;
    if (subject && publicKey && privateKey) {
      webpush.setVapidDetails(subject, publicKey, privateKey);
    }
  }

  async dispatchToFollowers(item: FeedItem): Promise<void> {
    const follows = await prisma.userFollow.findMany({
      where: { projectId: item.projectId },
    });
    await Promise.all(follows.map((f) => this.dispatchToUser(f.userId, item)));
  }

  async dispatchToUser(userId: string, item: FeedItem): Promise<void> {
    const [filters, mutes] = await Promise.all([
      prisma.filter.findMany({ where: { userId, isActive: true } }),
      prisma.muteKeyword.findMany({ where: { userId } }),
    ]);
    // Per-user filter check. Since dispatchToFollowers only fans out to users
    // who follow the project, the follows set for shouldShow is just the
    // current project — the per-user follow happened at dispatch-time.
    if (
      !shouldShow(
        { projectId: item.projectId, text: item.text },
        new Set([item.projectId]),
        filters,
        mutes,
      )
    ) {
      return;
    }
    const subs = await prisma.pushSubscription.findMany({ where: { userId } });
    const payload = JSON.stringify({
      title: `@${item.username}`,
      body: item.text.slice(0, 200),
      url: item.tweetUrl,
      tag: `${item.projectId}:${item.id}`,
    });
    await Promise.all(
      subs.map((s) => this.sendOne(s.endpoint, s.p256dh, s.auth, payload)),
    );
  }

  private async sendOne(
    endpoint: string,
    p256dh: string,
    auth: string,
    payload: string,
  ): Promise<void> {
    try {
      await webpush.sendNotification(
        { endpoint, keys: { p256dh, auth } },
        payload,
        { TTL: 60 * 60 },
      );
    } catch (err: unknown) {
      const status =
        err && typeof err === "object" && "statusCode" in err
          ? (err as { statusCode: number }).statusCode
          : undefined;
      if (status === 404 || status === 410) {
        await prisma.pushSubscription.deleteMany({ where: { endpoint } });
        return;
      }
      console.error("[push] delivery failed:", err);
    }
  }
}
