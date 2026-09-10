import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { startFeedWorker } from "./feed/feed.js";
import { authTokensRouter } from "./routes/auth-tokens.js";
import { feedRouter } from "./routes/feed.js";
import { projectsRouter } from "./routes/projects.js";
import { webhooksRouter } from "./routes/webhooks.js";

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

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.use("/projects", projectsRouter);
  app.use("/auth-tokens", authTokensRouter);
  app.use("/webhooks", webhooksRouter);
  app.use("/feed", feedRouter);

  return app;
}

export function startServer(port = Number(process.env.PORT ?? 5500)) {
  const app = createApp();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: { origin: "*" },
  });

  io.on("connection", (socket) => {
    console.log(`[socket] connected ${socket.id}`);
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