import type { NextFunction, Request, Response } from "express";
import { refreshIfNeeded, resolveSession, SESSION_COOKIE } from "./sessions.js";
import type { User } from "../generated/prisma/client.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User;
      sessionId?: string;
      sessionExpiresAt?: Date;
    }
  }
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (!k) continue;
    out[k] = decodeURIComponent(v);
  }
  return out;
}

function setSessionCookie(res: Response, token: string, expiresAt: Date): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function requireUser(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[SESSION_COOKIE];
  if (!token) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const resolved = await resolveSession(token);
  if (!resolved) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const refreshed = await refreshIfNeeded(resolved.session);
  if (refreshed.expiresAt.getTime() !== resolved.session.expiresAt.getTime()) {
    setSessionCookie(res, token, refreshed.expiresAt);
  }
  req.user = resolved.user;
  req.sessionId = resolved.session.id;
  req.sessionExpiresAt = refreshed.expiresAt;
  next();
}
