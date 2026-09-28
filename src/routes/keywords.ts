import { Router } from "express";
import { HttpError } from "../lib/http-error.js";
import {
  createKeyword,
  deleteKeyword,
  listKeywords,
  updateKeyword,
  type KeywordInput,
} from "../services/keywords.js";

export const keywordsRouter = Router();

function readKeywordInput(body: unknown): KeywordInput {
  if (!body || typeof body !== "object") return {};
  const value = body as Record<string, unknown>;
  const input: KeywordInput = {};
  if (typeof value.phrase === "string") input.phrase = value.phrase;
  if ("tag" in value) {
    if (value.tag === null) input.tag = null;
    else if (typeof value.tag === "string") input.tag = value.tag;
  }
  if (typeof value.enabled === "boolean") input.enabled = value.enabled;
  return input;
}

function sendError(res: import("express").Response, error: unknown) {
  if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  console.error(error);
  res.status(500).json({
    error: error instanceof Error ? error.message : "Internal server error",
  });
}

keywordsRouter.get("/", async (_req, res) => {
  try {
    res.json({ keywords: await listKeywords() });
  } catch (error) {
    sendError(res, error);
  }
});

keywordsRouter.post("/", async (req, res) => {
  try {
    const keyword = await createKeyword(readKeywordInput(req.body));
    res.status(201).json({ keyword });
  } catch (error) {
    sendError(res, error);
  }
});

keywordsRouter.patch("/:id", async (req, res) => {
  try {
    const keyword = await updateKeyword(
      req.params.id as string,
      readKeywordInput(req.body),
    );
    res.json({ keyword });
  } catch (error) {
    sendError(res, error);
  }
});

keywordsRouter.delete("/:id", async (req, res) => {
  try {
    res.json(await deleteKeyword(req.params.id as string));
  } catch (error) {
    sendError(res, error);
  }
});
