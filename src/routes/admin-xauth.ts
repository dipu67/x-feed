import { Router } from "express";
import { prisma } from "../db/prisma.js";
import { requireAdmin } from "../auth/admin.js";

export const adminXAuthRouter = Router();
adminXAuthRouter.use(requireAdmin);

adminXAuthRouter.post("/users/:userId/link-x", async (req, res) => {
  const userId = req.params.userId!;
  const xauthtokenId = req.body?.xauthtokenId;
  if (typeof xauthtokenId !== "string") {
    res.status(400).json({ error: "xauthtokenId required" });
    return;
  }
  // Validate the user exists so we don't link a token to a phantom id.
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) { res.status(404).json({ error: "user not found" }); return; }
  await prisma.xauthtoken.update({ where: { id: xauthtokenId }, data: { userId } });
  res.json({ ok: true });
});

adminXAuthRouter.delete("/users/:userId/link-x/:xauthtokenId", async (req, res) => {
  const { userId, xauthtokenId } = req.params;
  await prisma.xauthtoken.updateMany({
    where: { id: xauthtokenId!, userId: userId! },
    data: { userId: null },
  });
  res.json({ ok: true });
});
