import type { NextFunction, Request, Response } from "express";

const HEADER = "x-admin-token";

function readProvided(req: Request): string | null {
  const fromHeader = req.get(HEADER);
  if (fromHeader) return fromHeader;
  const auth = req.get("authorization");
  if (auth) {
    const m = /^Bearer\s+(.+)$/i.exec(auth);
    if (m && m[1]) return m[1];
  }
  return null;
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) {
    // Fail closed: if no admin token is configured, refuse admin operations.
    res.status(503).json({ error: "Admin token not configured" });
    return;
  }
  const provided = readProvided(req);
  if (provided !== expected) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}
