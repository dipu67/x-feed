import type { User } from "../generated/prisma/client.js";
import { prisma } from "../db/prisma.js";
import { randomToken, sha256Hex } from "./tokens.js";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const REFRESH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const SESSION_COOKIE = "xfeed_session";

export type ResolvedSession = {
  user: User;
  session: { id: string; expiresAt: Date };
};

export async function createSession(userId: string): Promise<{
  token: string;
  expiresAt: Date;
}> {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.userSession.create({
    data: { userId, tokenHash: sha256Hex(token), expiresAt },
  });
  return { token, expiresAt };
}

export async function revokeSession(token: string): Promise<void> {
  await prisma.userSession.deleteMany({
    where: { tokenHash: sha256Hex(token) },
  });
}

export async function resolveSession(
  token: string,
): Promise<ResolvedSession | null> {
  const session = await prisma.userSession.findUnique({
    where: { tokenHash: sha256Hex(token) },
    include: { user: true },
  });
  if (!session) return null;
  if (session.expiresAt.getTime() < Date.now()) {
    await prisma.userSession.delete({ where: { id: session.id } });
    return null;
  }
  if (!session.user.isActive) return null;
  await prisma.userSession.update({
    where: { id: session.id },
    data: { lastUsedAt: new Date() },
  });
  return { user: session.user, session: { id: session.id, expiresAt: session.expiresAt } };
}

export async function refreshIfNeeded(
  session: { id: string; expiresAt: Date },
): Promise<{ token?: string; expiresAt: Date }> {
  const ms = session.expiresAt.getTime() - Date.now();
  if (ms > REFRESH_WINDOW_MS) return { expiresAt: session.expiresAt };
  const newExpiry = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.userSession.update({
    where: { id: session.id },
    data: { expiresAt: newExpiry },
  });
  return { expiresAt: newExpiry };
}
