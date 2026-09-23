import { Router } from "express";
import { prisma } from "../db/prisma.js";
import { requireUser } from "../auth/middleware.js";
import { XWriteClient } from "../twitter/XWriteClient.js";

export const postRouter = Router();
postRouter.use(requireUser);

async function clientFor(userId: string): Promise<XWriteClient | null> {
  const token = await prisma.xauthtoken.findFirst({ where: { userId, isActive: true } });
  if (!token) return null;
  return new XWriteClient({
    authToken: token.authToken,
    ct0: token.ct0,
    username: token.username,
  });
}

postRouter.post("/", async (req, res) => {
  const client = await clientFor(req.user!.id);
  if (!client) { res.status(409).json({ error: "no linked X account" }); return; }
  const { text, replyToTweetId } = req.body ?? {};
  if (typeof text !== "string" || text.length === 0) {
    res.status(400).json({ error: "text required" });
    return;
  }
  const r = await client.post(
    text,
    typeof replyToTweetId === "string" ? replyToTweetId : undefined,
  );
  res.status(r.ok ? 201 : 502).json(r);
});

postRouter.post("/:id/like", async (req, res) => {
  const client = await clientFor(req.user!.id);
  if (!client) { res.status(409).json({ error: "no linked X account" }); return; }
  const r = await client.like(req.params.id!);
  res.status(r.ok ? 200 : 502).json(r);
});

postRouter.post("/:id/retweet", async (req, res) => {
  const client = await clientFor(req.user!.id);
  if (!client) { res.status(409).json({ error: "no linked X account" }); return; }
  const r = await client.retweet(req.params.id!);
  res.status(r.ok ? 200 : 502).json(r);
});

postRouter.post("/:id/reply", async (req, res) => {
  const client = await clientFor(req.user!.id);
  if (!client) { res.status(409).json({ error: "no linked X account" }); return; }
  const text = req.body?.text;
  if (typeof text !== "string") { res.status(400).json({ error: "text required" }); return; }
  const r = await client.reply(req.params.id!, text);
  res.status(r.ok ? 201 : 502).json(r);
});
