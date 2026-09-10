import { Router } from "express";
import {
  createProject,
  deleteProject,
  getProject,
  HttpError,
  listProjects,
  updateProject,
  type ProjectInput,
} from "../services/projects.js";

export const projectsRouter = Router();

function readProjectInput(body: unknown): ProjectInput {
  if (!body || typeof body !== "object") return {};
  const value = body as Record<string, unknown>;
  const text = (key: string): string | undefined =>
    typeof value[key] === "string" ? value[key] : undefined;
  const nullable = (key: string): string | null | undefined => {
    if (!(key in value)) return undefined;
    const current = value[key];
    if (current === null) return null;
    if (typeof current === "string") return current;
    return undefined;
  };

  const input: ProjectInput = {};
  const username = text("username");
  const userId = text("userId");
  const name = text("name");
  const description = nullable("description");
  const website = nullable("website");
  const github = nullable("github");
  const chain = nullable("chain");
  const tokenAddress = nullable("tokenAddress");
  if (username !== undefined) input.username = username;
  if (userId !== undefined) input.userId = userId;
  if (name !== undefined) input.name = name;
  if (description !== undefined) input.description = description;
  if (website !== undefined) input.website = website;
  if (github !== undefined) input.github = github;
  if (chain !== undefined) input.chain = chain;
  if (tokenAddress !== undefined) input.tokenAddress = tokenAddress;
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

projectsRouter.get("/", async (_req, res) => {
  try {
    res.json({ projects: await listProjects() });
  } catch (error) {
    sendError(res, error);
  }
});

projectsRouter.get("/:userId", async (req, res) => {
  try {
    res.json({ project: await getProject(req.params.userId as string) });
  } catch (error) {
    sendError(res, error);
  }
});

projectsRouter.post("/", async (req, res) => {
  try {
    const project = await createProject(readProjectInput(req.body));
    res.status(201).json({ project });
  } catch (error) {
    sendError(res, error);
  }
});

projectsRouter.patch("/:userId", async (req, res) => {
  try {
    const project = await updateProject(
      req.params.userId as string,
      readProjectInput(req.body),
    );
    res.json({ project });
  } catch (error) {
    sendError(res, error);
  }
});

projectsRouter.delete("/:userId", async (req, res) => {
  try {
    res.json(await deleteProject(req.params.userId as string));
  } catch (error) {
    sendError(res, error);
  }
});
