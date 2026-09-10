import { Router } from "express";
import { prisma } from "../db/prisma.js";

export const feedRouter = Router();

feedRouter.get("/", async (req, res) => {
  try {
    const rawLimit = Number(req.query.limit ?? 50);
    const limit = Number.isFinite(rawLimit)
      ? Math.min(Math.max(rawLimit, 1), 200)
      : 50;

    const items = await prisma.feedItem.findMany({
      take: limit,
      orderBy: { detectedAt: "desc" },
      include: { project: true },
    });

    res.json({
      items: items.map((item) => ({
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
