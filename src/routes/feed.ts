import { Router } from "express";
import { prisma } from "../db/prisma.js";
import { requireUser } from "../auth/middleware.js";
import { shouldShow, toFilterRule } from "../feed/filter-evaluator.js";

export const feedRouter = Router();

// The feed requires a session — there is no logged-out view.
feedRouter.use(requireUser);

feedRouter.get("/", async (req, res) => {
  try {
    const rawLimit = Number(req.query.limit ?? 50);
    const limit = Number.isFinite(rawLimit)
      ? Math.min(Math.max(rawLimit, 1), 200)
      : 50;

    const matchedOnly = ["1", "true"].includes(String(req.query.matched ?? ""));

    const items = await prisma.feedItem.findMany({
      take: limit,
      orderBy: { detectedAt: "desc" },
      include: { project: true },
      ...(matchedOnly ? { where: { matchedCount: { gt: 0 } } } : {}),
    });

    let visible = items;
    if (req.query.filter === "mine") {
      const user = req.user!;
      const [follows, filters, mutes] = await Promise.all([
        prisma.userFollow.findMany({ where: { userId: user.id } }),
        prisma.filter.findMany({ where: { userId: user.id } }),
        prisma.muteKeyword.findMany({ where: { userId: user.id } }),
      ]);
      const followSet = new Set(follows.map((f) => f.projectId));
      visible = items.filter((item) =>
        shouldShow(
          { projectId: item.projectId, text: item.text },
          followSet,
          filters.map(toFilterRule),
          mutes,
        ),
      );
    }

    res.json({
      items: visible.map((item) => ({
        id: item.id,
        projectId: item.projectId,
        username: item.username,
        text: item.text,
        tweetUrl: item.tweetUrl,
        postedAt: item.postedAt.toISOString(),
        likes: item.likes,
        reposts: item.reposts,
        replies: item.replies,
        payload: item.payload,
        detectedAt: item.detectedAt.toISOString(),
        matchedKeywords: item.matchedKeywords ?? null,
        project: {
          userId: item.project.userId,
          name: item.project.name,
          username: item.project.username,
          chain: item.project.chain,
          tokenAddress: item.project.tokenAddress,
          profileImageUrl: item.project.profileImageUrl,
        },
      })),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Internal server error",
    });
  }
});

feedRouter.delete("/:id", async (req, res) => {
  try {
    const { count } = await prisma.feedItem.deleteMany({
      where: { id: req.params.id },
    });
    if (count === 0) {
      res.status(404).json({ error: "Feed item not found" });
      return;
    }
    res.json({ deleted: true, id: req.params.id });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Internal server error",
    });
  }
});

