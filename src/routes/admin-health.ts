import { Router } from "express";
import { requireAdmin } from "../auth/admin.js";
import { prisma } from "../db/prisma.js";

export const adminHealthRouter = Router();
adminHealthRouter.use(requireAdmin);

adminHealthRouter.get("/twitter", async (_req, res) => {
  const tokens = await prisma.xauthtoken.findMany({
    where: { isActive: true },
    select: { username: true, userId: true },
  });
  res.json({
    accounts: tokens.map((t) => ({
      username: t.username,
      linkedToUser: t.userId !== null,
    })),
  });
});

adminHealthRouter.get("/push", async (_req, res) => {
  const [total, withUser] = await Promise.all([
    prisma.pushSubscription.count(),
    prisma.pushSubscription.count({ where: { userId: { not: null } } }),
  ]);
  res.json({ total, withUser });
});
