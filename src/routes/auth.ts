import { Router } from "express";
import { prisma } from "../db/prisma.js";
import { verifyPassword } from "../auth/password.js";
import {
  createSession,
  revokeSession,
  SESSION_COOKIE,
} from "../auth/sessions.js";
import { requireUser } from "../auth/middleware.js";

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
