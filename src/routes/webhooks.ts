import { Router } from "express";
import { HttpError, upsertProjectFromWebhook } from "../services/projects.js";

export const webhooksRouter = Router();

webhooksRouter.get("/", (_req, res) => {
  res.json({
    method: "POST",
    path: "/api/webhooks/projects",
    secretConfigured: Boolean(process.env.WEBHOOK_SECRET),
    header: "X-Webhook-Secret",
    fields: [
      { name: "username", required: false, description: "Twitter handle" },
      { name: "userId", required: false, description: "Twitter rest id" },
      { name: "name", required: false, description: "Display name" },
      { name: "description", required: false, description: "Notes" },
      { name: "website", required: false, description: "Website URL" },
      { name: "github", required: false, description: "GitHub URL" },
      { name: "chain", required: false, description: "Chain name" },
      { name: "tokenAddress", required: false, description: "Token address" },
    ],
    example: {
      username: "projecthandle",
      name: "Optional display name",
      chain: "solana",
    },
  });
});

function requireWebhookSecret(
  req: import("express").Request,
  res: import("express").Response,
  next: import("express").NextFunction,
) {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) {
    next();
    return;
  }
  const provided =
    req.get("x-webhook-secret") ??
    req.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (provided !== secret) {
    res.status(401).json({ error: "Invalid webhook secret" });
    return;
  }
  next();
}

webhooksRouter.post("/projects", requireWebhookSecret, async (req, res) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const username = typeof body.username === "string" ? body.username : undefined;
    const userId = typeof body.userId === "string" ? body.userId : undefined;
    if (!username && !userId) {
      throw new HttpError(400, "username or userId is required");
    }

    const project = await upsertProjectFromWebhook({
      ...(username !== undefined ? { username } : {}),
      ...(userId !== undefined ? { userId } : {}),
      ...(typeof body.name === "string" ? { name: body.name } : {}),
      ...(typeof body.description === "string" || body.description === null
        ? { description: body.description as string | null }
        : {}),
      ...(typeof body.website === "string" || body.website === null
        ? { website: body.website as string | null }
        : {}),
      ...(typeof body.github === "string" || body.github === null
        ? { github: body.github as string | null }
        : {}),
      ...(typeof body.chain === "string" || body.chain === null
        ? { chain: body.chain as string | null }
        : {}),
      ...(typeof body.tokenAddress === "string" || body.tokenAddress === null
        ? { tokenAddress: body.tokenAddress as string | null }
        : {}),
    });

    res.status(201).json({ project });
  } catch (error) {
    if (error instanceof HttpError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    console.error(error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Internal server error",
    });
  }
});
