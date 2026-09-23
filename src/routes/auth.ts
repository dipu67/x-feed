import { Router } from "express";
import { prisma } from "../db/prisma.js";
import { hashPassword, verifyPassword } from "../auth/password.js";
import {
  createSession,
  revokeSession,
  SESSION_COOKIE,
} from "../auth/sessions.js";
import { requireUser } from "../auth/middleware.js";
import { sha256Hex } from "../auth/tokens.js";

export const authRouter = Router();

authRouter.post("/login", async (req, res) => {
  const { email, password } = req.body ?? {};
  if (typeof email !== "string" || typeof password !== "string") {
    res.status(400).json({ error: "email and password required" });
    return;
  }
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.isActive) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }
  const ok = await verifyPassword(user.passwordHash, password);
  if (!ok) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }
  const { token, expiresAt } = await createSession(user.id);
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
  res.json({ id: user.id, email: user.email, displayName: user.displayName });
});

authRouter.post("/logout", async (req, res) => {
  const token = req.cookies?.[SESSION_COOKIE];
  if (typeof token === "string") await revokeSession(token);
  res.clearCookie(SESSION_COOKIE, { path: "/" });
  res.json({ ok: true });
});

authRouter.get("/me", requireUser, (req, res) => {
  const u = req.user!;
  res.json({ id: u.id, email: u.email, displayName: u.displayName });
});

authRouter.post("/accept-invite", async (req, res) => {
  const { token, displayName, password } = req.body ?? {};
  if (typeof token !== "string" || typeof password !== "string") {
    res.status(400).json({ error: "token and password required" });
    return;
  }
  if (password.length < 12) {
    res.status(400).json({ error: "password must be at least 12 characters" });
    return;
  }
  const invite = await prisma.userInvite.findUnique({
    where: { tokenHash: sha256Hex(token) },
  });
  if (!invite || invite.acceptedAt || invite.expiresAt.getTime() < Date.now()) {
    res.status(410).json({ error: "Invite expired or already used" });
    return;
  }
  if (invite.email) {
    const existingEmail = await prisma.user.findUnique({
      where: { email: invite.email },
    });
    if (existingEmail) {
      res.status(409).json({ error: "Email already registered" });
      return;
    }
  }
  const user = await prisma.user.create({
    data: {
      email: invite.email ?? `user-${invite.id}@invited.local`,
      passwordHash: await hashPassword(password),
      displayName: typeof displayName === "string" ? displayName : null,
    },
  });
  await prisma.userInvite.update({
    where: { id: invite.id },
    data: { acceptedById: user.id, acceptedAt: new Date() },
  });
  const { token: sessionToken, expiresAt } = await createSession(user.id);
  res.cookie(SESSION_COOKIE, sessionToken, {
    httpOnly: true, secure: true, sameSite: "lax", path: "/", expires: expiresAt,
  });
  res.json({ id: user.id, email: user.email, displayName: user.displayName });
});
