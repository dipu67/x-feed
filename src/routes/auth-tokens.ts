import { Router } from "express";
import {
  createAuthToken,
  deleteAuthToken,
  listAuthTokens,
  updateAuthToken,
  type AuthTokenInput,
} from "../services/auth-tokens.js";
import { HttpError } from "../services/projects.js";

export const authTokensRouter = Router();

function readInput(body: unknown): AuthTokenInput {
  if (!body || typeof body !== "object") return {};
  const value = body as Record<string, unknown>;
  const text = (key: string): string | undefined =>
    typeof value[key] === "string" ? value[key] : undefined;
  const input: AuthTokenInput = {};
  const id = text("id");
  const username = text("username");
  const authToken = text("authToken");
  const ct0 = text("ct0");
  if (id !== undefined) input.id = id;
  if (username !== undefined) input.username = username;
  if (authToken !== undefined) input.authToken = authToken;
  if (ct0 !== undefined) input.ct0 = ct0;
  if (typeof value.isActive === "boolean") input.isActive = value.isActive;
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

authTokensRouter.get("/", async (_req, res) => {
  try {
    res.json({ tokens: await listAuthTokens() });
  } catch (error) {
    sendError(res, error);
  }
});

authTokensRouter.post("/", async (req, res) => {
  try {
    const token = await createAuthToken(readInput(req.body));
    res.status(201).json({ token });
  } catch (error) {
    sendError(res, error);
  }
});

authTokensRouter.patch("/:id", async (req, res) => {
  try {
    const token = await updateAuthToken(
      req.params.id as string,
      readInput(req.body),
    );
    res.json({ token });
  } catch (error) {
    sendError(res, error);
  }
});

authTokensRouter.delete("/:id", async (req, res) => {
  try {
    res.json(await deleteAuthToken(req.params.id as string));
  } catch (error) {
    sendError(res, error);
  }
});
