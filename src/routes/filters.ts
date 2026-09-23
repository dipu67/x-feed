import { Router } from "express";
import { prisma } from "../db/prisma.js";
import { requireUser } from "../auth/middleware.js";

export const filtersRouter = Router();
filtersRouter.use(requireUser);

filtersRouter.get("/", async (req, res) => {
  const list = await prisma.filter.findMany({ where: { userId: req.user!.id } });
  res.json(list);
});

filtersRouter.post("/", async (req, res) => {
  const { name, kind, projectId, pattern, action } = req.body ?? {};
  if (
    typeof name !== "string" ||
    (kind !== "project" && kind !== "keyword") ||
    (action !== "keep" && action !== "hide")
  ) {
    res.status(400).json({ error: "invalid filter" });
    return;
  }
  // A project-kind filter without a projectId would match nothing — reject
  // up front rather than silently saving a useless rule.
  if (kind === "project" && typeof projectId !== "string") {
    res.status(400).json({ error: "projectId required for project kind" });
    return;
  }
  const f = await prisma.filter.create({
    data: {
      userId: req.user!.id,
      name,
      kind,
      projectId: typeof projectId === "string" ? projectId : null,
      pattern: typeof pattern === "string" ? pattern : null,
      action,
    },
  });
  res.status(201).json(f);
});

filtersRouter.patch("/:id", async (req, res) => {
  const id = req.params.id!;
  const existing = await prisma.filter.findFirst({ where: { id, userId: req.user!.id } });
  if (!existing) { res.status(404).json({ error: "not found" }); return; }
  // Whitelist mutable fields — never let a user reassign userId or other
  // ownership metadata through a PATCH.
  const allowed: Array<keyof typeof existing> = ["name", "kind", "projectId", "pattern", "action", "isActive"];
  const data: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in (req.body ?? {})) data[key] = req.body[key];
  }
  const f = await prisma.filter.update({ where: { id }, data });
  res.json(f);
});

filtersRouter.delete("/:id", async (req, res) => {
  const id = req.params.id!;
  await prisma.filter.deleteMany({ where: { id, userId: req.user!.id } });
  res.json({ ok: true });
});

export const mutesRouter = Router();
mutesRouter.use(requireUser);

mutesRouter.get("/", async (req, res) => {
  res.json(await prisma.muteKeyword.findMany({ where: { userId: req.user!.id } }));
});

mutesRouter.post("/", async (req, res) => {
  const { pattern, isRegex } = req.body ?? {};
  if (typeof pattern !== "string") { res.status(400).json({ error: "pattern required" }); return; }
  if (isRegex === true) {
    try { new RegExp(pattern); } catch { res.status(400).json({ error: "invalid regex" }); return; }
  }
  const m = await prisma.muteKeyword.create({
    data: { userId: req.user!.id, pattern, isRegex: Boolean(isRegex) },
  });
  res.status(201).json(m);
});

mutesRouter.delete("/:id", async (req, res) => {
  const id = req.params.id!;
  await prisma.muteKeyword.deleteMany({ where: { id, userId: req.user!.id } });
  res.json({ ok: true });
});
