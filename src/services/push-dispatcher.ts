import webpush from "web-push";
import type { Server as SocketServer } from "socket.io";
import { prisma } from "../db/prisma.js";
import { shouldShow, toFilterRule } from "../feed/filter-evaluator.js";
import type { FeedItem } from "../generated/prisma/client.js";

type DispatcherOpts = {
  concurrency?: number;
  io?: SocketServer | undefined;
};

export class PushDispatcher {
  private readonly concurrency: number;
  private readonly io: SocketServer | undefined;
  constructor(opts: DispatcherOpts = {}) {
    this.concurrency = opts.concurrency ?? 16;
    this.io = opts.io;
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

  /**
   * Global broadcast: every push subscription receives every tweet. No
   * follow requirement. A subscription belonging to a logged-in user still
   * honors that user's own filters/mutes; anonymous subscriptions always
   * receive everything. Socket fan-out is NOT done here — feed.ts emits
   * `feed:new` globally, so per-room emits would only duplicate it.
   */
  async dispatchToAllSubscribers(item: FeedItem): Promise<void> {
    const subs = await prisma.pushSubscription.findMany();
    const filterCache = new Map<string, boolean>();
    const jobs: Array<() => Promise<void>> = [];

    for (const sub of subs) {
      if (sub.userId !== null) {
        let show = filterCache.get(sub.userId);
        if (show === undefined) {
          show = await this.userAllows(sub.userId, item);
          filterCache.set(sub.userId, show);
        }
        if (!show) continue;
      }
      const payload = JSON.stringify({
        title: `@${item.username}`,
        body: item.text.slice(0, 200),
        url: item.tweetUrl,
        tag: `${item.projectId}:${item.id}`,
      });
      jobs.push(() => this.sendOne(sub.endpoint, sub.p256dh, sub.auth, payload));
    }
    await this.runPool(jobs);
  }

  /** Does this user's filter/mute configuration allow the item through? */
  private async userAllows(userId: string, item: FeedItem): Promise<boolean> {
    const [filters, mutes] = await Promise.all([
      prisma.filter.findMany({ where: { userId, isActive: true } }),
      prisma.muteKeyword.findMany({ where: { userId } }),
    ]);
    return shouldShow(
      { projectId: item.projectId, text: item.text },
      new Set([item.projectId]),
      filters.map(toFilterRule),
      mutes,
    );
  }

  /**
   * Run a list of thunks with at most `this.concurrency` invocations in
   * flight at any time. Without this, dispatching thousands of push calls
   * at once would saturate the host's outbound sockets.
   */
  private async runPool(jobs: Array<() => Promise<void>>): Promise<void> {
    const cap = Math.max(1, this.concurrency);
    let next = 0;
    const workers = Array.from({ length: Math.min(cap, jobs.length) }, async () => {
      while (true) {
        const i = next++;
        if (i >= jobs.length) return;
        await jobs[i]!();
      }
    });
    await Promise.all(workers);
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
