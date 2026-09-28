import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import cookieParser from "cookie-parser";
import { resolveSession, SESSION_COOKIE } from "./auth/sessions.js";
import { startFeedWorker } from "./feed/feed.js";
import { adminInvitesRouter } from "./routes/admin-invites.js";
import { authRouter } from "./routes/auth.js";
import { authTokensRouter } from "./routes/auth-tokens.js";
import { feedRouter } from "./routes/feed.js";
import { growthRouter } from "./routes/growth.js";
import { keywordsRouter } from "./routes/keywords.js";
import { projectsRouter } from "./routes/projects.js";
import { pushRouter } from "./routes/push.js";
import { webhooksRouter } from "./routes/webhooks.js";
import { filtersRouter, mutesRouter } from "./routes/filters.js";
import { adminXAuthRouter } from "./routes/admin-xauth.js";
import { adminHealthRouter } from "./routes/admin-health.js";
import { postRouter } from "./routes/post.js";

export function createApp() {
  const app = express();

  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, X-Webhook-Secret",
    );
    res.setHeader(
      "Access-Control-Allow-Methods",
      "GET,POST,PATCH,DELETE,OPTIONS",
    );
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  });

  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.use("/projects", projectsRouter);
  app.use("/auth-tokens", authTokensRouter);
  app.use("/auth", authRouter);
  app.use("/admin", adminInvitesRouter);
  app.use("/admin", adminXAuthRouter);
  app.use("/admin/health", adminHealthRouter);
  app.use("/webhooks", webhooksRouter);
  app.use("/feed", feedRouter);
  app.use("/growth", growthRouter);
  app.use("/keywords", keywordsRouter);
  app.use("/push", pushRouter);
  app.use("/filters", filtersRouter);
  app.use("/mute-keywords", mutesRouter);
  app.use("/post", postRouter);

  return app;
}

export function startServer(port = Number(process.env.PORT ?? 5500)) {
  const app = createApp();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: { origin: "*" },
    pingInterval: 25000
  });

  io.on("connection", (socket) => {
    console.log(`[socket] connected ${socket.id}`);
    // The browser sends its session cookie on the handshake; resolve it and
    // join the per-user room so feed fan-out can target this socket.
    const cookies = parseCookies(socket.handshake.headers.cookie);
    const token = cookies[SESSION_COOKIE];
    if (token) {
      resolveSession(token).then((r) => {
        if (r) socket.join(`user:${r.user.id}`);
      });
    }
    socket.on("disconnect", () => {
      console.log(`[socket] disconnected ${socket.id}`);
    });
  });

  startFeedWorker(io);

  httpServer.listen(port, () => {
    console.log(`x-feed listening on http://localhost:${port}`);
  });

  return { app, httpServer, io };
}
/** Tiny cookie parser used by the socket auth path — keeps the module out of
 * the express stack so it doesn't run on every HTTP request. */
function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}
