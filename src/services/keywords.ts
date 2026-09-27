import { prisma } from "../db/prisma.js";
import { HttpError } from "../lib/http-error.js";

export type KeywordInput = {
  phrase?: string;
  tag?: string | null;
  enabled?: boolean;
};

export type KeywordDTO = {
  id: string;
  phrase: string;
  tag: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

const MAX_PHRASE_LENGTH = 100;
const MAX_TAG_LENGTH = 30;

function normalizePhrase(value: string | undefined): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new HttpError(400, "phrase is required");
  }
  const phrase = value.trim().toLowerCase();
  if (phrase.length > MAX_PHRASE_LENGTH) {
    throw new HttpError(
      400,
      `phrase must be at most ${MAX_PHRASE_LENGTH} characters`,
    );
  }
  return phrase;
}

function normalizeTag(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const tag = value.trim();
  if (tag === "") return null;
  if (tag.length > MAX_TAG_LENGTH) {
    throw new HttpError(400, `tag must be at most ${MAX_TAG_LENGTH} characters`);
  }
  return tag;
}

// Keyword.id is BigInt and JSON-serializable only as a string — never
// res.json() a raw prisma keyword row.
function toDTO(keyword: {
  id: bigint;
  phrase: string;
  tag: string | null;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}): KeywordDTO {
  return {
    id: keyword.id.toString(),
    phrase: keyword.phrase,
    tag: keyword.tag,
    enabled: keyword.enabled,
    createdAt: keyword.createdAt.toISOString(),
    updatedAt: keyword.updatedAt.toISOString(),
  };
}

function parseId(id: string): bigint {
  try {
    return BigInt(id);
  } catch {
    throw new HttpError(400, "Invalid keyword id");
  }
}

function pgCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

export async function listKeywords(): Promise<KeywordDTO[]> {
  const keywords = await prisma.keyword.findMany({
    orderBy: { createdAt: "desc" },
  });
  return keywords.map(toDTO);
}

export async function createKeyword(input: KeywordInput): Promise<KeywordDTO> {
  const phrase = normalizePhrase(input.phrase);
  const tag = normalizeTag(input.tag);
  try {
    const keyword = await prisma.keyword.create({
      data: { phrase, tag, enabled: input.enabled ?? true },
    });
    return toDTO(keyword);
  } catch (error) {
    // Postgres unique-violation, case-insensitive thanks to lowercasing.
    // Prisma 7 driver adapters surface it as P2002; raw pg code is 23505.
    const code = pgCode(error);
    if (code === "23505" || code === "P2002") {
      throw new HttpError(409, `Keyword "${phrase}" already exists`);
    }
    throw error;
  }
}

export async function updateKeyword(
  id: string,
  input: KeywordInput,
): Promise<KeywordDTO> {
  if (input.phrase !== undefined) {
    throw new HttpError(
      400,
      "phrase is immutable; delete and re-create the keyword",
    );
  }
  const data: { tag?: string | null; enabled?: boolean } = {};
  if (input.tag !== undefined) data.tag = normalizeTag(input.tag);
  if (input.enabled !== undefined) data.enabled = input.enabled;
  let keyword;
  try {
    keyword = await prisma.keyword.update({ where: { id: parseId(id) }, data });
  } catch (error) {
    if (pgCode(error) === "P2025") {
      throw new HttpError(404, "Keyword not found");
    }
    throw error;
  }
  return toDTO(keyword);
}

export async function deleteKeyword(
  id: string,
): Promise<{ deleted: boolean; id: string }> {
  try {
    await prisma.keyword.delete({ where: { id: parseId(id) } });
  } catch (error) {
    if (pgCode(error) === "P2025") {
      throw new HttpError(404, "Keyword not found");
    }
    throw error;
  }
  return { deleted: true, id };
}
