import type { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../db/prisma.js";
import { fxTwitter } from "../fxTwitter/client.js";
import { seedStatusesCursorTop } from "../fxTwitter/statuses.js";
import type { APIUser } from "../fxTwitter/types.js";

export class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "HttpError";
  }
}

export type ProjectInput = {
  username?: string;
  userId?: string;
  name?: string;
  description?: string | null;
  website?: string | null;
  github?: string | null;
  chain?: string | null;
  tokenAddress?: string | null;
};

function normalizeHandle(value: string): string {
  return value.trim().replace(/^@/, "").toLowerCase();
}

function optionalText(
  value: string | null | undefined,
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export function mapProject(project: {
  userId: string;
  name: string;
  username: string;
  twitterName: string | null;
  followers: number;
  following: number;
  tweets: number;
  description: string | null;
  website: string | null;
  github: string | null;
  chain: string | null;
  tokenAddress: string | null;
  profileImageUrl: string | null;
  lastFetchedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    userId: project.userId,
    name: project.name,
    username: project.username,
    twitterName: project.twitterName,
    followers: project.followers,
    following: project.following,
    tweets: project.tweets,
    description: project.description,
    website: project.website,
    github: project.github,
    chain: project.chain,
    tokenAddress: project.tokenAddress,
    profileImageUrl: project.profileImageUrl,
    lastFetchedAt: project.lastFetchedAt?.toISOString() ?? null,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  };
}

async function lookupTwitterUser(input: ProjectInput): Promise<APIUser> {
  const handle = input.userId
    ? `id:${input.userId}`
    : input.username
      ? normalizeHandle(input.username)
      : "";

  if (!handle) {
    throw new HttpError(400, "username or userId is required");
  }

  const response = await fxTwitter.getProfile(handle);
  if (!response.user) {
    throw new HttpError(
      404,
      response.message || `Twitter user not found: ${handle}`,
    );
  }
  return response.user;
}

function profileFields(user: APIUser) {
  return {
    userId: user.id,
    username: user.screen_name,
    twitterName: user.name,
    followers: user.followers,
    following: user.following,
    tweets: user.statuses,
    profileImageUrl: user.avatar_url ?? null,
  };
}

export async function listProjects() {
  const projects = await prisma.project.findMany({
    orderBy: { createdAt: "desc" },
  });
  return projects.map(mapProject);
}

export async function getProject(userId: string) {
  const project = await prisma.project.findUnique({ where: { userId } });
  if (!project) throw new HttpError(404, "Project not found");
  return mapProject(project);
}

export async function createProject(input: ProjectInput) {
  const user = await lookupTwitterUser(input);
  const existing = await prisma.project.findUnique({
    where: { userId: user.id },
  });
  if (existing) {
    throw new HttpError(409, `Project already exists for @${existing.username}`);
  }

  const profile = profileFields(user);
  const fxTwitterCursorTop = await seedStatusesCursorTop(profile.username);
  const project = await prisma.project.create({
    data: {
      userId: profile.userId,
      username: profile.username,
      twitterName: profile.twitterName,
      followers: profile.followers,
      following: profile.following,
      tweets: profile.tweets,
      profileImageUrl: profile.profileImageUrl,
      fxTwitterCursorTop,
      name: input.name?.trim() || user.name,
      description: optionalText(input.description) ?? null,
      website: optionalText(input.website) ?? user.website?.url ?? null,
      github: optionalText(input.github) ?? null,
      chain: optionalText(input.chain) ?? null,
      tokenAddress: optionalText(input.tokenAddress) ?? null,
    },
  });
  return mapProject(project);
}

export async function upsertProjectFromWebhook(input: ProjectInput) {
  const user = await lookupTwitterUser(input);
  const profile = profileFields(user);
  const name = input.name?.trim() || user.name;

  const fxTwitterCursorTop = await seedStatusesCursorTop(profile.username);
  const data: Prisma.ProjectUncheckedCreateInput = {
    userId: profile.userId,
    username: profile.username,
    twitterName: profile.twitterName,
    followers: profile.followers,
    following: profile.following,
    tweets: profile.tweets,
    profileImageUrl: profile.profileImageUrl,
    fxTwitterCursorTop,
    name,
    description: optionalText(input.description) ?? null,
    website: optionalText(input.website) ?? user.website?.url ?? null,
    github: optionalText(input.github) ?? null,
    chain: optionalText(input.chain) ?? null,
    tokenAddress: optionalText(input.tokenAddress) ?? null,
  };

  const update: Prisma.ProjectUncheckedUpdateInput = {
    username: profile.username,
    twitterName: profile.twitterName,
    followers: profile.followers,
    following: profile.following,
    tweets: profile.tweets,
    profileImageUrl: profile.profileImageUrl,
    name,
  };
  if (input.description !== undefined) {
    update.description = optionalText(input.description) ?? null;
  }
  if (input.website !== undefined) {
    update.website = optionalText(input.website) ?? null;
  }
  if (input.github !== undefined) {
    update.github = optionalText(input.github) ?? null;
  }
  if (input.chain !== undefined) {
    update.chain = optionalText(input.chain) ?? null;
  }
  if (input.tokenAddress !== undefined) {
    update.tokenAddress = optionalText(input.tokenAddress) ?? null;
  }

  const project = await prisma.project.upsert({
    where: { userId: profile.userId },
    create: data,
    update,
  });

  return mapProject(project);
}

export async function updateProject(userId: string, input: ProjectInput) {
  const existing = await prisma.project.findUnique({ where: { userId } });
  if (!existing) throw new HttpError(404, "Project not found");

  const data: Prisma.ProjectUpdateInput = {};
  if (input.name !== undefined) data.name = input.name.trim() || existing.name;
  if (input.description !== undefined) {
    data.description = optionalText(input.description) ?? null;
  }
  if (input.website !== undefined) {
    data.website = optionalText(input.website) ?? null;
  }
  if (input.github !== undefined) data.github = optionalText(input.github) ?? null;
  if (input.chain !== undefined) data.chain = optionalText(input.chain) ?? null;
  if (input.tokenAddress !== undefined) {
    data.tokenAddress = optionalText(input.tokenAddress) ?? null;
  }

  if (input.username && normalizeHandle(input.username) !== existing.username.toLowerCase()) {
    const user = await lookupTwitterUser({ username: input.username });
    if (user.id !== existing.userId) {
      throw new HttpError(
        400,
        "username belongs to a different Twitter user; create a new project instead",
      );
    }
    data.username = user.screen_name;
    data.twitterName = user.name;
    data.followers = user.followers;
    data.following = user.following;
    data.tweets = user.statuses;
    data.profileImageUrl = user.avatar_url ?? null;
  }

  const project = await prisma.project.update({
    where: { userId },
    data,
  });
  return mapProject(project);
}

export async function deleteProject(userId: string) {
  const existing = await prisma.project.findUnique({ where: { userId } });
  if (!existing) throw new HttpError(404, "Project not found");
  await prisma.project.delete({ where: { userId } });
  return { deleted: true, userId };
}
