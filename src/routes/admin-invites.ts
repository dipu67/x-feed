import { Router } from "express";
import { prisma } from "../db/prisma.js";
import { randomToken, sha256Hex } from "../auth/tokens.js";
import { requireAdmin } from "../auth/admin.js";

export const adminInvitesRouter = Router();
adminInvitesRouter.use(requireAdmin);

const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

adminInvitesRouter.post("/users/invites", async (req, res) => {
  const { invitedById, email } = req.body ?? {};
  if (typeof invitedById !== "string") {
    res.status(400).json({ error: "invitedById required" });
    return;
  }
  // Validate the inviter exists and is active.
  const inviter = await prisma.user.findUnique({ where: { id: invitedById } });
  if (!inviter || !inviter.isActive) {
    res.status(400).json({ error: "invitedById must reference an active user" });
    return;
  }
  const token = randomToken();
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
  const invite = await prisma.userInvite.create({
    data: {
      tokenHash: sha256Hex(token),
      invitedById,
      email: typeof email === "string" ? email : null,
      expiresAt,
    },
  });
  res.status(201).json({ id: invite.id, token, expiresAt });
});

adminInvitesRouter.get("/users/invites", async (_req, res) => {
  const invites = await prisma.userInvite.findMany({
    where: {
      acceptedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
  });
  // Don't leak tokenHash — strip it.
  res.json(invites.map(({ tokenHash, ...rest }) => rest));
});

adminInvitesRouter.delete("/users/invites/:id", async (req, res) => {
  const id = req.params.id!;
  await prisma.userInvite.deleteMany({ where: { id } });
  res.json({ ok: true });
});
