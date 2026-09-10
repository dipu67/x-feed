import { prisma } from "../db/prisma.js";
import { TwitterClient } from "../TwitterClient/index.js";
import { HttpError } from "./projects.js";

export type AuthTokenPublic = {
  id: string;
  username: string;
  isActive: boolean;
  authTokenHint: string;
  createdAt: string;
  updatedAt: string;
};

export type AuthTokenInput = {
  id?: string;
  username?: string;
  authToken?: string;
  ct0?: string;
  isActive?: boolean;
};

function maskSecret(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 4) return "••••";
  return `••••${trimmed.slice(-4)}`;
}

function mapToken(token: {
  id: string;
  username: string;
  isActive: boolean;
  authToken: string;
  createdAt: Date;
  updatedAt: Date;
}): AuthTokenPublic {
  return {
    id: token.id,
    username: token.username,
    isActive: token.isActive,
    authTokenHint: maskSecret(token.authToken),
    createdAt: token.createdAt.toISOString(),
    updatedAt: token.updatedAt.toISOString(),
  };
}

async function resolveOwner(
  authToken: string,
  ct0: string,
  fallback: { id?: string; username?: string },
) {
  const client = new TwitterClient({ cookies: { authToken, ct0 } });
  const me = await client.getCurrentUser();
  if (me.success && me.user) {
    return {
      id: me.user.id,
      username: fallback.username?.trim() || me.user.username,
    };
  }
  const id = fallback.id?.trim();
  const username = fallback.username?.trim();
  if (id && username) {
    return { id, username };
  }
  throw new HttpError(
    400,
    me.error ||
      "Could not verify cookies. Provide username and Twitter user id, or check authToken/ct0.",
  );
}

export async function listAuthTokens() {
  const tokens = await prisma.xauthtoken.findMany({
    orderBy: { createdAt: "desc" },
  });
  return tokens.map(mapToken);
}

export async function createAuthToken(input: AuthTokenInput) {
  const authToken = input.authToken?.trim();
  const ct0 = input.ct0?.trim();
  if (!authToken || !ct0) {
    throw new HttpError(400, "authToken and ct0 are required");
  }

  const owner = await resolveOwner(authToken, ct0, {
    ...(input.id !== undefined ? { id: input.id } : {}),
    ...(input.username !== undefined ? { username: input.username } : {}),
  });

  const existing = await prisma.xauthtoken.findFirst({
    where: {
      OR: [{ id: owner.id }, { username: owner.username }, { authToken }],
    },
  });
  if (existing) {
    throw new HttpError(409, `Auth token already exists for @${existing.username}`);
  }

  const token = await prisma.xauthtoken.create({
    data: {
      id: owner.id,
      username: owner.username,
      authToken,
      ct0,
      isActive: input.isActive ?? true,
    },
  });
  return mapToken(token);
}

export async function updateAuthToken(id: string, input: AuthTokenInput) {
  const existing = await prisma.xauthtoken.findUnique({ where: { id } });
  if (!existing) throw new HttpError(404, "Auth token not found");

  const nextAuth = input.authToken?.trim() || existing.authToken;
  const nextCt0 = input.ct0?.trim() || existing.ct0;
  const cookiesChanged =
    Boolean(input.authToken?.trim()) || Boolean(input.ct0?.trim());

  let username = input.username?.trim() || existing.username;
  if (cookiesChanged) {
    const owner = await resolveOwner(nextAuth, nextCt0, {
      id: existing.id,
      username,
    });
    username = owner.username;
  }

  const token = await prisma.xauthtoken.update({
    where: { id },
    data: {
      username,
      authToken: nextAuth,
      ct0: nextCt0,
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    },
  });
  return mapToken(token);
}

export async function deleteAuthToken(id: string) {
  const existing = await prisma.xauthtoken.findUnique({ where: { id } });
  if (!existing) throw new HttpError(404, "Auth token not found");
  await prisma.xauthtoken.delete({ where: { id } });
  return { deleted: true, id };
}
