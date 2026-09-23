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
  // Atomic claim: only one concurrent caller can set acceptedAt. Whoever
  // wins count=1 proceeds to create the user; the loser sees count=0 and
  // gets a clean 410. Run as updateMany so the predicate is enforced at
  // the SQL level (a plain .update would race two concurrent callers
  // through the invite-update phase, leaking an orphan user).
  const claim = await prisma.userInvite.updateMany({
    where: { id: invite.id, acceptedAt: null, expiresAt: { gt: new Date() } },
    data: { acceptedAt: new Date() },
  });
  if (claim.count === 0) {
    res.status(410).json({ error: "Invite expired or already used" });
    return;
  }
  let user: { id: string; email: string; displayName: string | null };
  try {
    user = await prisma.user.create({
      data: {
        email: invite.email ?? `user-${invite.id}@invited.local`,
        passwordHash: await hashPassword(password),
        displayName: typeof displayName === "string" ? displayName : null,
      },
    });
  } catch (err) {
    // User creation failed after we claimed the invite — release the claim so
    // the invite isn't permanently marked used for a user that doesn't exist.
    await prisma.userInvite
      .update({
        where: { id: invite.id },
        data: { acceptedAt: null, acceptedById: null },
      })
      .catch(() => undefined);
    if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "P2002") {
      const target = (err as { meta?: { target?: string[] } }).meta?.target;
      if (Array.isArray(target) && target.includes("email")) {
        res.status(409).json({ error: "Email already registered" });
        return;
      }
    }
    throw err;
  }
  await prisma.userInvite.update({
    where: { id: invite.id },
    data: { acceptedById: user.id },
  });
  const { token: sessionToken, expiresAt } = await createSession(user.id);
  res.cookie(SESSION_COOKIE, sessionToken, {
    httpOnly: true, secure: true, sameSite: "lax", path: "/", expires: expiresAt,
  });
  res.json({ id: user.id, email: user.email, displayName: user.displayName });
});
