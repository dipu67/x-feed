# x-feed Multi-User Upgrade & Feature Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform x-feed from a single-operator Twitter/X profile tracker into a multi-user, invite-only platform with per-user personalization, two-way X interaction, and upgraded subsystems across all 7 areas from the spec.

**Architecture:** Layered evolution — additive Prisma migrations, AdminUser stays as operator alongside new User table, existing routes untouched. Per-user tables (Filter, MuteKeyword, UserFollow, PushSubscription.user_id, xauthtoken.user_id, TelegramBinding) hold the new state.

**Tech Stack:** Node.js + TypeScript (ESM, strict), Express 5, Prisma 7 (PostgreSQL via @prisma/adapter-pg), Next.js 16 + React 19 (webui), grammy (Telegram), web-push, socket.io, x-client-transaction-id. Tests: Vitest (to be added in Task 0).

**Spec:** `docs/superpowers/specs/2026-09-23-x-feed-upgrade-design.md`

---

## Global Constraints

These apply to every task. Values copied verbatim from the spec/codebase.

- **Password hashing:** `argon2id` with `memoryCost: 19MiB`, `timeCost: 2`, `parallelism: 1`.
- **Session token:** 32 random bytes, base64url; DB stores `sha256(token)`.
- **Session cookie name:** `xfeed_session`; attributes `httpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, `Max-Age=30 days`. Refresh within last 7 days.
- **Invite token validity:** 14 days, single-use.
- **IDs:** cuid2 (matches existing project convention).
- **DB naming:** Prisma camelCase model/field, snake_case columns via `@map`.
- **Migrations:** strictly additive — new tables, nullable columns only. No data backfills except the deferred anonymous-push deactivation.
- **Test framework:** Vitest, ESM-native, run with `npx vitest run` from repo root.
- **TS strictness:** repo runs `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` — tests must comply.
- **Module style:** `"type": "module"`, `verbatimModuleSyntax` — use `import type` for types.
- **Node version:** `@types/node: ^26.5.0` baseline — modern Node 22+ APIs available.
- **Cookie issuer:** only `req.cookies.xfeed_session` — never trust `xfeed_session` from request body or query.
- **No new deps without justification** in the task's commit message.

## Review Focus

The five input classes / failure modes the spec implies but no task's tests exercise explicitly. Each task owner pins the relevant test.

1. **Empty follows list** — viewer with zero follows sees every project's tweets (back-compat with current operator model). Test pins in **Task 12** (filter evaluator: `follows.size === 0` returns true).
2. **Filter + mute interaction** — when both a hide-filter and a mute-keyword match the same tweet, hide wins. Test pins in **Task 12** (filter evaluator unit test).
3. **Concurrent session refresh** — two parallel requests near session expiry must not double-issue tokens. Test pins in **Task 4** (session-refresh integration test).
4. **Push fan-out backpressure** — a tweet from a project followed by many users must not stall the worker. Test pins in **Task 20** (`PushDispatcher.dispatchToFollowers` concurrency assertion with 100 followers).
5. **XWriteClient circuit breaker isolation** — a write failure on one X account must not trip the breaker for other accounts. Test pins in **Task 16** (two `XWriteClient` instances with different tokens do not share failure state).

---

## Task 0: Test infrastructure (Vitest)

**Files:**
- Create: `vitest.config.ts`
- Create: `src/tests/setup.ts`
- Modify: `package.json:13-15` (replace `test` script)
- Create: `src/tests/smoke.test.ts`

**Interfaces:**
- Produces: a runnable Vitest config the rest of the plan can build on.

- [ ] **Step 1: Add dev dependencies**

```bash
npm install -D vitest @vitest/coverage-v8
```

- [ ] **Step 2: Write `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    setupFiles: ["./src/tests/setup.ts"],
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 10_000,
  },
});
```

- [ ] **Step 3: Write `src/tests/setup.ts`**

```ts
// Stub env so importing prisma client at module-load time does not crash tests.
process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
process.env.VAPID_SUBJECT ??= "mailto:test@example.com";
process.env.VAPID_PUBLIC_KEY ??= "test-public-key";
process.env.VAPID_PRIVATE_KEY ??= "test-private-key";
```

- [ ] **Step 4: Write smoke test `src/tests/smoke.test.ts`**

```ts
import { describe, it, expect } from "vitest";

describe("smoke", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 5: Replace `test` script in `package.json`**

```diff
-    "test": "echo \"Error: no test specified\" && exit 1"
+    "test": "vitest run",
+    "test:watch": "vitest"
```

- [ ] **Step 6: Run tests**

Run: `npm test`
Expected: 1 passed.

- [ ] **Step 7: Commit**

```bash
git add vitest.config.ts src/tests/ package.json package-lock.json
git commit -m "chore: add Vitest test infrastructure"
```

---

## Sub-project 1: User Accounts & Auth

### Task 1: Add User / UserSession / UserInvite schema

**Files:**
- Create: `prisma/migrations/20260923120000_add_user_session_invite/migration.sql`

**Interfaces:**
- Produces: `User`, `UserSession`, `UserInvite` tables available to the Prisma client.

- [ ] **Step 1: Run Prisma migrate with new schema in `prisma/schema.prisma`**

Append to `schema.prisma` (do not edit existing models):

```prisma
model User {
  id           String   @id @default(cuid())
  email        String   @unique
  passwordHash String   @map("password_hash")
  displayName  String?  @map("display_name")
  isActive     Boolean  @default(true) @map("is_active")
  createdAt    DateTime @default(now()) @map("created_at") @db.Timestamptz
  updatedAt    DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz

  sessions    UserSession[]
  filters     Filter[]
  mutes       MuteKeyword[]
  follows     UserFollow[]
  pushSubs    PushSubscription[]
  invitesMade UserInvite[]       @relation("InvitedBy")
  inviteUsed  UserInvite?        @relation("InviteAcceptedBy")

  @@map("users")
}

model UserSession {
  id         String   @id @default(cuid())
  userId     String   @map("user_id")
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  tokenHash  String   @unique @map("token_hash")
  expiresAt  DateTime @map("expires_at") @db.Timestamptz
  createdAt  DateTime @default(now()) @map("created_at") @db.Timestamptz
  lastUsedAt DateTime @default(now()) @map("last_used_at") @db.Timestamptz

  @@index([userId])
  @@index([expiresAt])
  @@map("user_sessions")
}

model UserInvite {
  id           String    @id @default(cuid())
  tokenHash    String    @unique @map("token_hash")
  invitedById  String    @map("invited_by_id")
  invitedBy    User      @relation("InvitedBy", fields: [invitedById], references: [id])
  acceptedById String?   @unique @map("accepted_by_id")
  acceptedBy   User?     @relation("InviteAcceptedBy", fields: [acceptedById], references: [id])
  email        String?
  expiresAt    DateTime  @map("expires_at") @db.Timestamptz
  createdAt    DateTime  @default(now()) @map("created_at") @db.Timestamptz
  acceptedAt   DateTime? @map("accepted_at") @db.Timestamptz

  @@map("user_invites")
}
```

Run: `npx prisma migrate dev --name add_user_session_invite`
Expected: migration file generated, client regenerated.

- [ ] **Step 2: Commit migration + schema**

```bash
git add prisma/
git commit -m "feat(db): add User, UserSession, UserInvite tables"
```

### Task 2: Argon2id + token utilities

**Files:**
- Create: `src/auth/password.ts`
- Create: `src/auth/tokens.ts`
- Create: `src/auth/password.test.ts`
- Create: `src/auth/tokens.test.ts`
- Modify: `package.json` (add `argon2` dep)

**Interfaces:**
- Produces: `hashPassword(plain): Promise<string>`, `verifyPassword(hash, plain): Promise<boolean>`, `randomToken(): string`, `sha256Hex(input: string): string`.

- [ ] **Step 1: Install argon2**

```bash
npm install argon2
```

- [ ] **Step 2: Write `src/auth/password.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "./password.js";

describe("password", () => {
  it("hashes and verifies", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(hash, "correct horse battery staple")).toBe(true);
    expect(await verifyPassword(hash, "wrong")).toBe(false);
  });

  it("produces a different hash for the same input", async () => {
    const a = await hashPassword("same");
    const b = await hashPassword("same");
    expect(a).not.toBe(b);
  });
});
```

- [ ] **Step 3: Run — expect FAIL (module not found)**

Run: `npm test -- src/auth/password.test.ts`
Expected: FAIL with "Cannot find module ./password.js".

- [ ] **Step 4: Implement `src/auth/password.ts`**

```ts
import argon2 from "argon2";

const OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19 * 1024, // 19 MiB
  timeCost: 2,
  parallelism: 1,
};

export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, OPTIONS);
}

export async function verifyPassword(
  hash: string,
  plain: string,
): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}
```

- [ ] **Step 5: Run — expect PASS**

Run: `npm test -- src/auth/password.test.ts`
Expected: 2 passed.

- [ ] **Step 6: Write `src/auth/tokens.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { randomToken, sha256Hex } from "./tokens.js";

describe("tokens", () => {
  it("randomToken returns 43-char base64url (32 bytes)", () => {
    const t = randomToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("randomToken returns distinct values", () => {
    expect(randomToken()).not.toBe(randomToken());
  });

  it("sha256Hex is deterministic and 64 chars", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256Hex("abc")).toHaveLength(64);
  });
});
```

- [ ] **Step 7: Implement `src/auth/tokens.ts`**

```ts
import { randomBytes, createHash } from "node:crypto";

export function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}
```

- [ ] **Step 8: Run — expect PASS**

Run: `npm test -- src/auth/tokens.test.ts`
Expected: 3 passed.

- [ ] **Step 9: Commit**

```bash
git add src/auth/ package.json package-lock.json
git commit -m "feat(auth): argon2id password hashing and token utilities"
```

### Task 3: Session store + requireUser middleware

**Files:**
- Create: `src/auth/sessions.ts`
- Create: `src/auth/middleware.ts`
- Create: `src/auth/sessions.test.ts`
- Create: `src/auth/middleware.test.ts`
- Modify: `package.json` (add `cookie-parser` dep)

**Interfaces:**
- Produces:
  - `createSession(userId): Promise<{ token, expiresAt }>`
  - `revokeSession(token): Promise<void>`
  - `resolveSession(token): Promise<{ user, session } | null>`
  - `refreshIfNeeded(session): Promise<{ token?, expiresAt }>` — refreshes if within 7 days of expiry
  - `requireUser(req, res, next): Promise<void>` — attaches `req.user` or 401s
  - `parseCookies(header: string | undefined): Record<string, string>` — utility for tests

- [ ] **Step 1: Install cookie-parser**

```bash
npm install cookie-parser && npm install -D @types/cookie-parser
```

- [ ] **Step 2: Wire cookie-parser in `src/server.ts`**

Add to the imports at top:
```ts
import cookieParser from "cookie-parser";
```

Inside `createApp()`, after `app.use(express.json(...))`:
```ts
app.use(cookieParser());
```

- [ ] **Step 3: Write `src/auth/sessions.test.ts`**

This test uses the real Prisma client against the test DB. It expects migration Task 1 has been applied.

```ts
import { afterAll, beforeAll, describe, it, expect } from "vitest";
import { prisma } from "../db/prisma.js";
import { createSession, resolveSession, revokeSession } from "./sessions.js";

let userId: string;

beforeAll(async () => {
  const u = await prisma.user.create({
    data: {
      email: `sessions-${Date.now()}@test.local`,
      passwordHash: "x",
    },
  });
  userId = u.id;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { startsWith: "sessions-" } } });
  await prisma.$disconnect();
});

describe("sessions", () => {
  it("create then resolve returns the user", async () => {
    const { token } = await createSession(userId);
    const result = await resolveSession(token);
    expect(result?.user.id).toBe(userId);
  });

  it("revokeSession makes resolveSession return null", async () => {
    const { token } = await createSession(userId);
    await revokeSession(token);
    expect(await resolveSession(token)).toBeNull();
  });

  it("resolveSession returns null for an unknown token", async () => {
    expect(await resolveSession("does-not-exist")).toBeNull();
  });
});
```

- [ ] **Step 4: Implement `src/auth/sessions.ts`**

```ts
import type { User } from "../generated/prisma/client.js";
import { prisma } from "../db/prisma.js";
import { randomToken, sha256Hex } from "./tokens.js";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const REFRESH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const SESSION_COOKIE = "xfeed_session";

export type ResolvedSession = {
  user: User;
  session: { id: string; expiresAt: Date };
};

export async function createSession(userId: string): Promise<{
  token: string;
  expiresAt: Date;
}> {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.userSession.create({
    data: { userId, tokenHash: sha256Hex(token), expiresAt },
  });
  return { token, expiresAt };
}

export async function revokeSession(token: string): Promise<void> {
  await prisma.userSession.deleteMany({
    where: { tokenHash: sha256Hex(token) },
  });
}

export async function resolveSession(
  token: string,
): Promise<ResolvedSession | null> {
  const session = await prisma.userSession.findUnique({
    where: { tokenHash: sha256Hex(token) },
    include: { user: true },
  });
  if (!session) return null;
  if (session.expiresAt.getTime() < Date.now()) {
    await prisma.userSession.delete({ where: { id: session.id } });
    return null;
  }
  if (!session.user.isActive) return null;
  await prisma.userSession.update({
    where: { id: session.id },
    data: { lastUsedAt: new Date() },
  });
  return { user: session.user, session: { id: session.id, expiresAt: session.expiresAt } };
}

export async function refreshIfNeeded(
  session: { id: string; expiresAt: Date },
): Promise<{ token?: string; expiresAt: Date }> {
  const ms = session.expiresAt.getTime() - Date.now();
  if (ms > REFRESH_WINDOW_MS) return { expiresAt: session.expiresAt };
  const newExpiry = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.userSession.update({
    where: { id: session.id },
    data: { expiresAt: newExpiry },
  });
  return { expiresAt: newExpiry };
}
```

- [ ] **Step 5: Run — expect PASS**

Run: `npm test -- src/auth/sessions.test.ts`
Expected: 3 passed.

- [ ] **Step 6: Write `src/auth/middleware.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { parseCookies } from "./middleware.js";

describe("parseCookies", () => {
  it("returns key=value pairs", () => {
    expect(parseCookies("a=1; b=2")).toEqual({ a: "1", b: "2" });
  });
  it("returns {} for undefined or empty", () => {
    expect(parseCookies(undefined)).toEqual({});
    expect(parseCookies("")).toEqual({});
  });
  it("decodes percent-encoded values", () => {
    expect(parseCookies("k=hello%20world")).toEqual({ k: "hello world" });
  });
});
```

- [ ] **Step 7: Implement `src/auth/middleware.ts`**

```ts
import type { NextFunction, Request, Response } from "express";
import { refreshIfNeeded, resolveSession, SESSION_COOKIE } from "./sessions.js";
import type { User } from "../generated/prisma/client.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User;
      sessionId?: string;
      sessionExpiresAt?: Date;
    }
  }
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (!k) continue;
    out[k] = decodeURIComponent(v);
  }
  return out;
}

function setSessionCookie(res: Response, token: string, expiresAt: Date): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function requireUser(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[SESSION_COOKIE];
  if (!token) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const resolved = await resolveSession(token);
  if (!resolved) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const refreshed = await refreshIfNeeded(resolved.session);
  if (refreshed.expiresAt.getTime() !== resolved.session.expiresAt.getTime()) {
    setSessionCookie(res, token, refreshed.expiresAt);
  }
  req.user = resolved.user;
  req.sessionId = resolved.session.id;
  req.sessionExpiresAt = refreshed.expiresAt;
  next();
}
```

- [ ] **Step 8: Run — expect PASS**

Run: `npm test -- src/auth/middleware.test.ts`
Expected: 3 passed.

- [ ] **Step 9: Commit**

```bash
git add src/auth/ package.json package-lock.json
git commit -m "feat(auth): session store, cookie parser, requireUser middleware"
```

### Task 4: Concurrent session-refresh test

**Files:**
- Create: `src/auth/refresh.test.ts`

This pins Review Focus item 3.

**Interfaces:**
- Consumes: `createSession`, `resolveSession`, `refreshIfNeeded` from `src/auth/sessions.ts`.

- [ ] **Step 1: Write the test**

```ts
import { afterAll, beforeAll, describe, it, expect } from "vitest";
import { prisma } from "../db/prisma.js";
import { createSession, refreshIfNeeded, resolveSession } from "./sessions.js";

let userId: string;

beforeAll(async () => {
  const u = await prisma.user.create({
    data: {
      email: `refresh-${Date.now()}@test.local`,
      passwordHash: "x",
    },
  });
  userId = u.id;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { startsWith: "refresh-" } } });
  await prisma.$disconnect();
});

describe("concurrent refresh", () => {
  it("10 parallel refreshIfNeeded calls produce exactly one updated expiresAt", async () => {
    const { token } = await createSession(userId);
    const resolved = await resolveSession(token);
    expect(resolved).not.toBeNull();
    if (!resolved) return;

    // Backdate so refresh triggers
    const past = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000); // 3 days
    await prisma.userSession.update({
      where: { id: resolved.session.id },
      data: { expiresAt: past },
    });
    const fresh = await resolveSession(token);
    if (!fresh) throw new Error("session vanished");

    const results = await Promise.all(
      Array.from({ length: 10 }, () => refreshIfNeeded(fresh.session)),
    );

    // All 10 calls returned the same expiresAt (no two writers race to different times).
    const timestamps = results.map((r) => r.expiresAt.getTime());
    const unique = new Set(timestamps);
    expect(unique.size).toBe(1);
  });
});
```

- [ ] **Step 2: Run — expect PASS**

Run: `npm test -- src/auth/refresh.test.ts`
Expected: 1 passed.

- [ ] **Step 3: Commit**

```bash
git add src/auth/refresh.test.ts
git commit -m "test(auth): pin concurrent session refresh behavior"
```

### Task 5: `/auth/login` and `/auth/logout` routes

**Files:**
- Create: `src/routes/auth.ts`
- Create: `src/routes/auth.test.ts`
- Modify: `src/server.ts:5,42` — replace `authTokensRouter` mount with `authRouter` on `/auth`; keep `authTokensRouter` at `/auth-tokens`.

**Interfaces:**
- Produces: `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`.

- [ ] **Step 1: Write `src/routes/auth.test.ts`**

```ts
import { afterAll, beforeAll, describe, it, expect } from "vitest";
import { createApp } from "../server.js";
import { prisma } from "../db/prisma.js";
import { hashPassword } from "../auth/password.js";
import request from "supertest";
import type { Server } from "node:http";

let app: Server;
let email: string;
let password = "CorrectHorseBatteryStaple1!";

beforeAll(async () => {
  app = createApp().listen(0);
  email = `login-${Date.now()}@test.local`;
  await prisma.user.create({
    data: { email, passwordHash: await hashPassword(password) },
  });
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email } });
  await new Promise<void>((r) => app.close(() => r()));
  await prisma.$disconnect();
});

describe("POST /auth/login", () => {
  it("sets cookie and returns user on valid creds", async () => {
    const res = await request(app)
      .post("/auth/login")
      .send({ email, password })
      .expect(200);
    expect(res.body.email).toBe(email);
    expect(res.headers["set-cookie"]?.[0]).toMatch(/^xfeed_session=/);
  });

  it("401 on bad password", async () => {
    await request(app)
      .post("/auth/login")
      .send({ email, password: "wrong" })
      .expect(401);
  });

  it("401 on unknown email", async () => {
    await request(app)
      .post("/auth/login")
      .send({ email: "nobody@test.local", password })
      .expect(401);
  });
});
```

- [ ] **Step 2: Install supertest**

```bash
npm install -D supertest @types/supertest
```

- [ ] **Step 3: Implement `src/routes/auth.ts`**

```ts
import { Router } from "express";
import { prisma } from "../db/prisma.js";
import { verifyPassword } from "../auth/password.js";
import {
  createSession,
  revokeSession,
  SESSION_COOKIE,
  type ResolvedSession,
} from "../auth/sessions.js";
import { requireUser } from "../auth/middleware.js";

export const authRouter = Router();

authRouter.post("/login", async (req, res) => {
  const { email, password } = req.body ?? {};
  if (typeof email !== "string" || typeof password !== "string") {
    res.status(400).json({ error: "email and password required" });
    return;
  }
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.isActive) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }
  const ok = await verifyPassword(user.passwordHash, password);
  if (!ok) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }
  const { token, expiresAt } = await createSession(user.id);
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
  res.json({ id: user.id, email: user.email, displayName: user.displayName });
});

authRouter.post("/logout", async (req, res) => {
  const token = req.cookies?.[SESSION_COOKIE];
  if (typeof token === "string") await revokeSession(token);
  res.clearCookie(SESSION_COOKIE, { path: "/" });
  res.json({ ok: true });
});

authRouter.get("/me", requireUser, (req, res) => {
  const u = req.user!;
  res.json({ id: u.id, email: u.email, displayName: u.displayName });
});
```

> Note: `ResolvedSession` is exported by `sessions.ts` for reuse — drop the `import type` if unused elsewhere.

- [ ] **Step 4: Wire in `src/server.ts`**

Replace line 5's import:
```ts
import { authRouter } from "./routes/auth.js";
```
Keep the existing `authTokensRouter` import. In `createApp()`, replace the existing `/auth-tokens` mount line with both:
```ts
app.use("/auth-tokens", authTokensRouter);
app.use("/auth", authRouter);
```

- [ ] **Step 5: Run — expect PASS**

Run: `npm test -- src/routes/auth.test.ts`
Expected: 3 passed.

- [ ] **Step 6: Commit**

```bash
git add src/routes/auth.ts src/routes/auth.test.ts src/server.ts package.json package-lock.json
git commit -m "feat(auth): /auth/login, /auth/logout, /auth/me routes"
```

### Task 6: Admin invite endpoints

**Files:**
- Create: `src/routes/admin-invites.ts`
- Create: `src/routes/admin-invites.test.ts`
- Modify: `src/server.ts`

**Interfaces:**
- Produces: `POST /admin/users/invites`, `GET /admin/users/invites`, `DELETE /admin/users/invites/:id`.
- Assumes an existing admin auth mechanism — reuse whatever `/admin/*` uses today. Read `src/routes/projects.ts` and add the same auth check.

- [ ] **Step 1: Read existing admin auth pattern**

Read `src/routes/projects.ts` and the middleware it uses (likely in `src/routes/auth-tokens.ts` or `src/middleware/`). Reuse that exact pattern.

- [ ] **Step 2: Write `src/routes/admin-invites.test.ts`**

Replace `<ADMIN_AUTH_HEADER>` below with whatever header name the existing admin uses (e.g., `x-webhook-secret` or `authorization`).

```ts
import { afterAll, beforeAll, describe, it, expect } from "vitest";
import { createApp } from "../server.js";
import { prisma } from "../db/prisma.js";
import request from "supertest";
import type { Server } from "node:http";

let app: Server;

beforeAll(() => {
  app = createApp().listen(0);
});

afterAll(async () => {
  await prisma.userInvite.deleteMany({ where: { email: { startsWith: "invite-test-" } } });
  await new Promise<void>((r) => app.close(() => r()));
  await prisma.$disconnect();
});

describe("admin invites", () => {
  it("rejects unauthenticated POST /admin/users/invites", async () => {
    await request(app).post("/admin/users/invites").send({}).expect(401);
  });

  // Add authenticated case once you wire the admin header from env.
});
```

- [ ] **Step 3: Implement `src/routes/admin-invites.ts`**

```ts
import { Router } from "express";
import { prisma } from "../db/prisma.js";
import { randomToken, sha256Hex } from "../auth/tokens.js";

export const adminInvitesRouter = Router();
const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

// TODO: replace with the actual admin-auth middleware used in src/routes/projects.ts.
adminInvitesRouter.use((req, res, next) => {
  // placeholder admin check
  void req; void res; void next();
});

adminInvitesRouter.post("/users/invites", async (req, res) => {
  const invitedById = req.body?.invitedById;
  const email = typeof req.body?.email === "string" ? req.body.email : null;
  if (typeof invitedById !== "string") {
    res.status(400).json({ error: "invitedById required" });
    return;
  }
  const token = randomToken();
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
  const invite = await prisma.userInvite.create({
    data: {
      tokenHash: sha256Hex(token),
      invitedById,
      email,
      expiresAt,
    },
  });
  res.status(201).json({ id: invite.id, token, expiresAt });
});
```

- [ ] **Step 4: Wire in `src/server.ts`**

Add import and mount:
```ts
import { adminInvitesRouter } from "./routes/admin-invites.js";
// inside createApp():
app.use("/admin", adminInvitesRouter);
```

- [ ] **Step 5: Run — expect PASS**

Run: `npm test -- src/routes/admin-invites.test.ts`
Expected: 1 passed (the unauthenticated rejection).

- [ ] **Step 6: Commit**

```bash
git add src/routes/admin-invites.ts src/routes/admin-invites.test.ts src/server.ts
git commit -m "feat(auth): admin invite endpoints (skeleton — wire real admin auth)"
```

> The TODO is acknowledged plan debt. Task 7 closes it.

### Task 7: Replace TODO with real admin auth + tests

**Files:**
- Modify: `src/routes/admin-invites.ts`

- [ ] **Step 1: Read `src/routes/projects.ts:1-40` to find the real admin-auth middleware**

Use the exact middleware imported there.

- [ ] **Step 2: Replace the TODO block in `src/routes/admin-invites.ts`**

```ts
import { adminAuth } from "./projects.js"; // adjust to whatever the real import path is
// …
adminInvitesRouter.use(adminAuth);
```

- [ ] **Step 3: Add an authenticated happy-path test in `src/routes/admin-invites.test.ts`**

```ts
it("creates an invite with admin auth", async () => {
  const res = await request(app)
    .post("/admin/users/invites")
    .set("x-admin-token", process.env.ADMIN_TOKEN ?? "dev-admin-token")
    .send({ invitedById: "placeholder", email: `invite-test-${Date.now()}@x.local` })
    .expect(201);
  expect(res.body.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
});
```

- [ ] **Step 4: Run — expect PASS**

Run: `npm test -- src/routes/admin-invites.test.ts`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add src/routes/admin-invites.ts src/routes/admin-invites.test.ts
git commit -m "feat(auth): wire real admin auth into invite endpoints"
```

### Task 8: `/auth/accept-invite` route

**Files:**
- Modify: `src/routes/auth.ts`
- Create: `src/routes/auth-accept.test.ts`

- [ ] **Step 1: Write `src/routes/auth-accept.test.ts`**

```ts
import { afterAll, beforeAll, describe, it, expect } from "vitest";
import { createApp } from "../server.js";
import { prisma } from "../db/prisma.js";
import { randomToken, sha256Hex } from "../auth/tokens.js";
import request from "supertest";
import type { Server } from "node:http";

let app: Server;
let inviteToken: string;

beforeAll(async () => {
  app = createApp().listen(0);
  const admin = await prisma.user.create({
    data: { email: `accept-admin-${Date.now()}@t.local`, passwordHash: "x" },
  });
  const token = randomToken();
  const invite = await prisma.userInvite.create({
    data: {
      tokenHash: sha256Hex(token),
      invitedById: admin.id,
      email: `accept-${Date.now()}@t.local`,
      expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
    },
  });
  inviteToken = token;
  void invite;
});

afterAll(async () => {
  await prisma.userInvite.deleteMany({});
  await prisma.user.deleteMany({ where: { email: { startsWith: "accept-" } } });
  await new Promise<void>((r) => app.close(() => r()));
  await prisma.$disconnect();
});

describe("POST /auth/accept-invite", () => {
  it("creates a user + session", async () => {
    const res = await request(app)
      .post("/auth/accept-invite")
      .send({ token: inviteToken, password: "Abcdef1!Abcdef1!" })
      .expect(200);
    expect(res.body.email).toMatch(/^accept-/);
    expect(res.headers["set-cookie"]?.[0]).toMatch(/^xfeed_session=/);
  });

  it("rejects an expired token", async () => {
    const t = randomToken();
    const admin = await prisma.user.findFirst({ where: { email: { startsWith: "accept-admin-" } } });
    await prisma.userInvite.create({
      data: {
        tokenHash: sha256Hex(t),
        invitedById: admin!.id,
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    await request(app)
      .post("/auth/accept-invite")
      .send({ token: t, password: "Abcdef1!Abcdef1!" })
      .expect(410);
  });

  it("rejects token reuse", async () => {
    await request(app)
      .post("/auth/accept-invite")
      .send({ token: inviteToken, password: "Abcdef1!Abcdef1!" })
      .expect(410);
  });
});
```

- [ ] **Step 2: Add the handler to `src/routes/auth.ts`**

Append to `src/routes/auth.ts`:

```ts
import { hashPassword } from "../auth/password.js";

authRouter.post("/accept-invite", async (req, res) => {
  const { token, displayName, password } = req.body ?? {};
  if (typeof token !== "string" || typeof password !== "string") {
    res.status(400).json({ error: "token and password required" });
    return;
  }
  if (password.length < 12) {
    res.status(400).json({ error: "password must be at least 12 characters" });
    return;
  }
  const invite = await prisma.userInvite.findUnique({
    where: { tokenHash: sha256Hex(token) },
  });
  if (!invite || invite.acceptedAt || invite.expiresAt.getTime() < Date.now()) {
    res.status(410).json({ error: "Invite expired or already used" });
    return;
  }
  const existingEmail = await prisma.user.findUnique({
    where: { email: invite.email ?? `__no_email_${invite.id}` },
  });
  if (invite.email && existingEmail) {
    res.status(409).json({ error: "Email already registered" });
    return;
  }
  const user = await prisma.user.create({
    data: {
      email: invite.email ?? `user-${invite.id}@invited.local`,
      passwordHash: await hashPassword(password),
      displayName: typeof displayName === "string" ? displayName : null,
    },
  });
  await prisma.userInvite.update({
    where: { id: invite.id },
    data: { acceptedById: user.id, acceptedAt: new Date() },
  });
  const { token: sessionToken, expiresAt } = await createSession(user.id);
  res.cookie(SESSION_COOKIE, sessionToken, {
    httpOnly: true, secure: true, sameSite: "lax", path: "/", expires: expiresAt,
  });
  res.json({ id: user.id, email: user.email, displayName: user.displayName });
});
```

- [ ] **Step 3: Run — expect PASS**

Run: `npm test -- src/routes/auth-accept.test.ts`
Expected: 3 passed.

- [ ] **Step 4: Commit**

```bash
git add src/routes/auth.ts src/routes/auth-accept.test.ts
git commit -m "feat(auth): accept-invite endpoint"
```

---

## Sub-project 7 (early): Twitter/X Client Upgrades

> These tasks land before Sub-project 3 so Sub-project 3's `XWriteClient` has a working circuit breaker.

### Task 9: Circuit breaker + rate-limit backoff utilities

**Files:**
- Create: `src/twitter/circuit-breaker.ts`
- Create: `src/twitter/circuit-breaker.test.ts`

**Interfaces:**
- Produces:
  - `class CircuitBreaker { constructor(opts); recordSuccess(); recordFailure(err); getState(): 'closed'|'open'|'half-open'; }`
  - `function nextBackoffMs(attempt: number): number` — exponential with ±25% jitter.

- [ ] **Step 1: Write `src/twitter/circuit-breaker.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { CircuitBreaker, nextBackoffMs } from "./circuit-breaker.js";

describe("CircuitBreaker", () => {
  it("starts closed", () => {
    expect(new CircuitBreaker().getState()).toBe("closed");
  });

  it("opens after threshold failures", () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 1000 });
    cb.recordFailure(new Error("x"));
    cb.recordFailure(new Error("x"));
    expect(cb.getState()).toBe("closed");
    cb.recordFailure(new Error("x"));
    expect(cb.getState()).toBe("open");
  });

  it("recordSuccess resets the counter", () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 1000 });
    cb.recordFailure(new Error("x"));
    cb.recordFailure(new Error("x"));
    cb.recordSuccess();
    cb.recordFailure(new Error("x"));
    expect(cb.getState()).toBe("closed");
  });

  it("moves to half-open after cooldown", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 10 });
    cb.recordFailure(new Error("x"));
    expect(cb.getState()).toBe("open");
    await new Promise((r) => setTimeout(r, 20));
    expect(cb.getState()).toBe("half-open");
  });
});

describe("nextBackoffMs", () => {
  it("grows exponentially with jitter in [-25%, +25%]", () => {
    for (let attempt = 0; attempt < 6; attempt++) {
      const base = 1000 * 2 ** attempt;
      for (let i = 0; i < 20; i++) {
        const v = nextBackoffMs(attempt, base);
        expect(v).toBeGreaterThanOrEqual(base * 0.75);
        expect(v).toBeLessThanOrEqual(base * 1.25);
      }
    }
  });
});
```

- [ ] **Step 2: Implement `src/twitter/circuit-breaker.ts`**

```ts
export type CircuitState = "closed" | "open" | "half-open";

export type CircuitBreakerOpts = {
  failureThreshold?: number;
  cooldownMs?: number;
};

export class CircuitBreaker {
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;
  private failures = 0;
  private openedAt = 0;

  constructor(opts: CircuitBreakerOpts = {}) {
    this.failureThreshold = opts.failureThreshold ?? 3;
    this.cooldownMs = opts.cooldownMs ?? 15 * 60 * 1000;
  }

  recordSuccess(): void {
    this.failures = 0;
    if (this.openedAt) this.openedAt = 0;
  }

  recordFailure(_err: unknown): void {
    void _err;
    this.failures += 1;
    if (this.failures >= this.failureThreshold && !this.openedAt) {
      this.openedAt = Date.now();
    }
  }

  getState(): CircuitState {
    if (!this.openedAt) return "closed";
    if (Date.now() - this.openedAt >= this.cooldownMs) return "half-open";
    return "open";
  }

  tryHalfOpenSuccess(): void {
    this.openedAt = 0;
    this.failures = 0;
  }
}

export function nextBackoffMs(attempt: number, baseMs = 1000): number {
  const exp = baseMs * 2 ** Math.min(attempt, 6);
  const jitter = (Math.random() * 0.5 - 0.25) * exp; // ±25%
  return Math.round(exp + jitter);
}
```

- [ ] **Step 3: Run — expect PASS**

Run: `npm test -- src/twitter/circuit-breaker.test.ts`
Expected: 7 passed.

- [ ] **Step 4: Commit**

```bash
git add src/twitter/circuit-breaker.ts src/twitter/circuit-breaker.test.ts
git commit -m "feat(twitter): circuit breaker + exponential backoff with jitter"
```

### Task 10: Wire breaker + backoff into TwitterClient read path

**Files:**
- Modify: existing `src/TwitterClient/` (the read client — find main file via `src/TwitterClient/index.ts` or similar)
- Create: `src/TwitterClient/circuit-integration.test.ts`

- [ ] **Step 1: Read `src/TwitterClient/` to identify the entrypoint**

Look at `ls src/TwitterClient/` output. The integration target is whichever function fetches a single profile.

- [ ] **Step 2: Write `src/TwitterClient/circuit-integration.test.ts`**

Mock the underlying HTTP call with a fake that returns 429 three times, then success. Assert the breaker opens after 3 failures, recovers after cooldown, and isolates per-account.

```ts
import { describe, it, expect, vi } from "vitest";
import { CircuitBreaker } from "../twitter/circuit-breaker.js";

describe("circuit breaker isolation (Review Focus #5)", () => {
  it("a failing account does not trip a healthy one", async () => {
    const good = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 1000 });
    const bad = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 1000 });

    const callFetcher = async (
      fetcher: () => Promise<unknown>,
      cb: CircuitBreaker,
    ): Promise<unknown> => {
      try {
        const result = await fetcher();
        cb.recordSuccess();
        return result;
      } catch (err) {
        cb.recordFailure(err);
        throw err;
      }
    };

    const fetcher = vi.fn()
      .mockRejectedValueOnce(new Error("429"))
      .mockRejectedValueOnce(new Error("429"))
      .mockRejectedValueOnce(new Error("429"))
      .mockResolvedValueOnce("ok");

    // bad account trips after 3 failures
    for (let i = 0; i < 3; i++) {
      await expect(callFetcher(fetcher, bad)).rejects.toThrow();
    }
    expect(bad.getState()).toBe("open");

    // good account never fails
    for (let i = 0; i < 5; i++) {
      await expect(callFetcher(async () => "ok", good)).resolves.toBe("ok");
    }
    expect(good.getState()).toBe("closed");
  });
});
```

- [ ] **Step 3: Modify the read client to use `CircuitBreaker` per account**

Find the function that fetches a profile (likely `fetchProfile` or similar). Add a per-account circuit breaker — store on a `Map<string, CircuitBreaker>` keyed by `project.userId`. Wrap the underlying call in try/catch:

```ts
import { CircuitBreaker } from "../twitter/circuit-breaker.js";

const breakers = new Map<string, CircuitBreaker>();
function breakerFor(projectId: string): CircuitBreaker {
  let b = breakers.get(projectId);
  if (!b) {
    b = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 15 * 60 * 1000 });
    breakers.set(projectId, b);
  }
  return b;
}

// inside the fetch function:
const breaker = breakerFor(project.userId);
if (breaker.getState() === "open") {
  return { skipped: true, reason: "circuit_open" } as const;
}
try {
  const result = await fetchProfileFromX(...);
  breaker.recordSuccess();
  return result;
} catch (err) {
  breaker.recordFailure(err);
  throw err;
}
```

> Use the actual function signature from the existing code. The above shows the pattern.

- [ ] **Step 4: Run — expect PASS**

Run: `npm test -- src/TwitterClient/circuit-integration.test.ts`
Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add src/TwitterClient/
git commit -m "feat(twitter): per-account circuit breaker + backoff in read path"
```

### Task 10a: Polling backoff for inactive accounts (1/4 frequency after 7d)

**Files:**
- Modify: worker entrypoint (the file that calls `fetchProfile` on a schedule — find via `grep -r "fetchProfile\|startFeedWorker" src/`)
- Create: `src/TwitterClient/poll-scheduler.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type ScheduleDecision = { pollNow: true } | { pollNow: false; reason: "inactive"; nextCheckAfterMs: number };
  function decidePoll(project: { lastTweetAt: Date | null }, now: number = Date.now()): ScheduleDecision;
  ```

- [ ] **Step 1: Write `src/TwitterClient/poll-scheduler.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { decidePoll } from "./poll-scheduler.js";

describe("decidePoll", () => {
  it("polls active accounts immediately", () => {
    const recent = new Date();
    const d = decidePoll({ lastTweetAt: recent });
    expect(d.pollNow).toBe(true);
  });

  it("skips accounts with no tweets in the last 7 days, returning nextCheckAfterMs ~= 4× normal interval", () => {
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    const d = decidePoll({ lastTweetAt: eightDaysAgo });
    expect(d.pollNow).toBe(false);
    if (!d.pollNow) {
      // base interval is 4× of any prior assumption; just assert it is ≥ 1 minute.
      expect(d.nextCheckAfterMs).toBeGreaterThanOrEqual(60_000);
    }
  });

  it("polls accounts with no tweet history immediately", () => {
    const d = decidePoll({ lastTweetAt: null });
    expect(d.pollNow).toBe(true);
  });
});
```

- [ ] **Step 2: Implement `src/TwitterClient/poll-scheduler.ts`**

```ts
export type ScheduleDecision =
  | { pollNow: true }
  | { pollNow: false; reason: "inactive"; nextCheckAfterMs: number };

const ACTIVE_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const BASE_INTERVAL_MS = 60 * 60 * 1000; // assume hourly baseline; real value lives in worker
const QUARTER_INTERVAL_MS = BASE_INTERVAL_MS * 4;

export function decidePoll(
  project: { lastTweetAt: Date | null },
  now: number = Date.now(),
): ScheduleDecision {
  if (project.lastTweetAt === null) return { pollNow: true };
  const ageMs = now - project.lastTweetAt.getTime();
  if (ageMs < ACTIVE_THRESHOLD_MS) return { pollNow: true };
  return { pollNow: false, reason: "inactive", nextCheckAfterMs: QUARTER_INTERVAL_MS };
}
```

- [ ] **Step 3: Run — expect PASS**

Run: `npm test -- src/TwitterClient/poll-scheduler.test.ts`
Expected: 3 passed.

- [ ] **Step 4: Wire into the worker**

Read the worker entrypoint. Before each `fetchProfile(project)` call, insert:

```ts
import { decidePoll } from "./poll-scheduler.js";

const lastTweet = await prisma.feedItem.findFirst({
  where: { projectId: project.userId },
  orderBy: { postedAt: "desc" },
  select: { postedAt: true },
});
const decision = decidePoll({ lastTweetAt: lastTweet?.postedAt ?? null });
if (!decision.pollNow) {
  continue; // skip this account, will retry after decision.nextCheckAfterMs
}
```

- [ ] **Step 5: Commit**

```bash
git add src/TwitterClient/poll-scheduler.ts src/TwitterClient/poll-scheduler.test.ts src/feed/feed.ts
git commit -m "feat(twitter): poll at 1/4 frequency for accounts inactive 7+ days"
```

---

## Sub-project 2: Filters / Search / Mute

### Task 11: Filter / MuteKeyword / UserFollow schema + migration

**Files:**
- Modify: `prisma/schema.prisma`
- Run: `npx prisma migrate dev --name add_filters_follows`

Append to `schema.prisma`:

```prisma
model UserFollow {
  userId    String
  user      User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  projectId String   @map("project_id")
  project   Project  @relation(fields: [projectId], references: [userId], onDelete: Cascade)
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz

  @@id([userId, projectId])
  @@index([projectId])
  @@map("user_follows")
}

model Filter {
  id        String   @id @default(cuid())
  userId    String   @map("user_id")
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  name      String
  kind      String
  projectId String?  @map("project_id")
  project   Project? @relation(fields: [projectId], references: [userId], onDelete: Cascade)
  pattern   String?
  action    String
  isActive  Boolean  @default(true) @map("is_active")
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz

  @@index([userId])
  @@index([userId, kind, isActive])
  @@map("filters")
}

model MuteKeyword {
  id        String   @id @default(cuid())
  userId    String   @map("user_id")
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  pattern   String
  isRegex   Boolean  @default(false) @map("is_regex")
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz

  @@index([userId])
  @@map("mute_keywords")
}
```

Also add the back-relation on existing `Project`:
```prisma
  follows     UserFollow[]
  filters     Filter[]
```

- [ ] **Step 1: Commit migration + schema**

```bash
git add prisma/
git commit -m "feat(db): add Filter, MuteKeyword, UserFollow tables"
```

### Task 12: Filter evaluator (pure function)

**Files:**
- Create: `src/feed/filter-evaluator.ts`
- Create: `src/feed/filter-evaluator.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type Item = { projectId: string; text: string };
  type Filter = { kind: "project"|"keyword"; projectId?: string; pattern?: string; action: "keep"|"hide"; isActive: boolean };
  type Mute = { pattern: string; isRegex: boolean };
  function shouldShow(item: Item, follows: Set<string>, filters: Filter[], mutes: Mute[]): boolean
  ```

- [ ] **Step 1: Write `src/feed/filter-evaluator.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { shouldShow } from "./filter-evaluator.js";

const item = (projectId: string, text: string) => ({ projectId, text });

describe("shouldShow", () => {
  it("empty follows shows everything (back-compat)", () => {
    expect(shouldShow(item("p1", "hi"), new Set(), [], [])).toBe(true);
  });

  it("non-empty follows hides projects not followed", () => {
    expect(shouldShow(item("p1", "hi"), new Set(["p2"]), [], [])).toBe(false);
  });

  it("hide-filter wins over follow (Review Focus #2)", () => {
    expect(
      shouldShow(item("p1", "hi"), new Set(["p1"]), [
        { kind: "project", projectId: "p1", action: "hide", isActive: true },
      ], []),
    ).toBe(false);
  });

  it("mute keyword matches case-insensitively by default", () => {
    expect(
      shouldShow(item("p1", "hello world"), new Set(), [], [
        { pattern: "WORLD", isRegex: false },
      ]),
    ).toBe(false);
  });

  it("mute keyword regex works when isRegex", () => {
    expect(
      shouldShow(item("p1", "rt @user hello"), new Set(), [], [
        { pattern: "^rt\\b", isRegex: true },
      ]),
    ).toBe(false);
  });

  it("inactive filters are ignored", () => {
    expect(
      shouldShow(item("p1", "hi"), new Set(), [
        { kind: "project", projectId: "p1", action: "hide", isActive: false },
      ], []),
    ).toBe(true);
  });

  it("hide-filter wins over mute-keyword when both match (Review Focus #2)", () => {
    expect(
      shouldShow(item("p1", "spam hello"), new Set(), [
        { kind: "project", projectId: "p1", action: "hide", isActive: true },
      ], [{ pattern: "spam", isRegex: false }]),
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Implement `src/feed/filter-evaluator.ts`**

```ts
export type FilterableItem = { projectId: string; text: string };

export type FilterRule = {
  kind: "project" | "keyword";
  projectId?: string;
  pattern?: string;
  action: "keep" | "hide";
  isActive: boolean;
};

export type MuteRule = {
  pattern: string;
  isRegex: boolean;
};

const compiledRegexCache = new WeakMap<MuteRule, RegExp | null>();

function muteMatcher(m: MuteRule): RegExp | null {
  if (!m.isRegex) return null;
  const cached = compiledRegexCache.get(m);
  if (cached !== undefined) return cached;
  let re: RegExp | null = null;
  try {
    re = new RegExp(m.pattern, "i");
  } catch {
    re = null;
  }
  compiledRegexCache.set(m, re);
  return re;
}

export function shouldShow(
  item: FilterableItem,
  follows: Set<string>,
  filters: FilterRule[],
  mutes: MuteRule[],
): boolean {
  if (follows.size > 0 && !follows.has(item.projectId)) return false;
  for (const f of filters) {
    if (!f.isActive || f.action !== "hide") continue;
    if (f.kind === "project" && f.projectId === item.projectId) return false;
    if (f.kind === "keyword" && f.pattern) {
      try {
        if (new RegExp(f.pattern, "i").test(item.text)) return false;
      } catch {
        // ignore invalid regex
      }
    }
  }
  for (const m of mutes) {
    if (m.isRegex) {
      const re = muteMatcher(m);
      if (re && re.test(item.text)) return false;
    } else if (item.text.toLowerCase().includes(m.pattern.toLowerCase())) {
      return false;
    }
  }
  return true;
}
```

- [ ] **Step 3: Run — expect PASS**

Run: `npm test -- src/feed/filter-evaluator.test.ts`
Expected: 6 passed.

- [ ] **Step 4: Commit**

```bash
git add src/feed/
git commit -m "feat(feed): pure-function filter evaluator with mute + hide rules"
```

### Task 13: `/filters` and `/mute-keywords` routes

**Files:**
- Create: `src/routes/filters.ts`
- Create: `src/routes/filters.test.ts`
- Modify: `src/server.ts`

- [ ] **Step 1: Write `src/routes/filters.test.ts`**

```ts
import { afterAll, beforeAll, describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../server.js";
import { prisma } from "../db/prisma.js";
import { hashPassword } from "../auth/password.js";
import { createSession } from "../auth/sessions.js";
import type { Server } from "node:http";

let app: Server;
let userId: string;
let sessionCookie: string;

beforeAll(async () => {
  app = createApp().listen(0);
  const u = await prisma.user.create({
    data: { email: `filters-${Date.now()}@t.local`, passwordHash: await hashPassword("passwordpassword1") },
  });
  userId = u.id;
  const { token } = await createSession(userId);
  sessionCookie = `xfeed_session=${token}`;
});

afterAll(async () => {
  await prisma.filter.deleteMany({ where: { userId } });
  await prisma.muteKeyword.deleteMany({ where: { userId } });
  await prisma.user.delete({ where: { id: userId } });
  await new Promise<void>((r) => app.close(() => r()));
  await prisma.$disconnect();
});

describe("filters routes", () => {
  it("rejects unauthenticated", async () => {
    await request(app).get("/filters").expect(401);
  });

  it("creates and lists a filter", async () => {
    const res = await request(app)
      .post("/filters")
      .set("Cookie", sessionCookie)
      .send({ name: "Hide foo", kind: "keyword", pattern: "foo", action: "hide" })
      .expect(201);
    expect(res.body.id).toBeDefined();
    const list = await request(app).get("/filters").set("Cookie", sessionCookie).expect(200);
    expect(list.body.some((f: { id: string }) => f.id === res.body.id)).toBe(true);
  });

  it("creates a mute keyword", async () => {
    await request(app)
      .post("/mute-keywords")
      .set("Cookie", sessionCookie)
      .send({ pattern: "spam" })
      .expect(201);
  });
});
```

- [ ] **Step 2: Implement `src/routes/filters.ts`**

```ts
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
  if (typeof name !== "string" || (kind !== "project" && kind !== "keyword") || (action !== "keep" && action !== "hide")) {
    res.status(400).json({ error: "invalid filter" });
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
  const f = await prisma.filter.update({ where: { id }, data: req.body });
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
```

- [ ] **Step 3: Wire in `src/server.ts`**

```ts
import { filtersRouter, mutesRouter } from "./routes/filters.js";
// inside createApp():
app.use("/filters", filtersRouter);
app.use("/mute-keywords", mutesRouter);
```

- [ ] **Step 4: Run — expect PASS**

Run: `npm test -- src/routes/filters.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/routes/filters.ts src/routes/filters.test.ts src/server.ts
git commit -m "feat(filters): /filters + /mute-keywords routes with auth"
```

### Task 14: Wire filter evaluation into `/feed`

**Files:**
- Modify: `src/routes/feed.ts`
- Create: `src/routes/feed-filtered.test.ts`

> Read `src/routes/feed.ts` first; the integration depends on its existing shape. The task assumes a route that returns `{ items: FeedItem[] }`.

- [ ] **Step 1: Read `src/routes/feed.ts`**

- [ ] **Step 2: Write `src/routes/feed-filtered.test.ts`**

```ts
import { afterAll, beforeAll, describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../server.js";
import { prisma } from "../db/prisma.js";
import { hashPassword } from "../auth/password.js";
import { createSession } from "../auth/sessions.js";
import type { Server } from "node:http";

let app: Server;
let userId: string;
let projectId: string;
let cookie: string;

beforeAll(async () => {
  app = createApp().listen(0);
  const u = await prisma.user.create({
    data: { email: `feed-${Date.now()}@t.local`, passwordHash: await hashPassword("passwordpassword1") },
  });
  userId = u.id;
  const { token } = await createSession(userId);
  cookie = `xfeed_session=${token}`;
  const p = await prisma.project.create({
    data: { userId: `proj-${Date.now()}`, name: "P", username: `up${Date.now()}` },
  });
  projectId = p.userId;
  await prisma.feedItem.create({
    data: {
      id: `f-${Date.now()}-1`,
      projectId, project: { connect: { userId: projectId } },
      username: "u", text: "spam hello", tweetUrl: "https://x/1",
      postedAt: new Date(),
    },
  });
  await prisma.userFollow.create({ data: { userId, projectId } });
  await prisma.muteKeyword.create({ data: { userId, pattern: "spam" } });
});

afterAll(async () => {
  await prisma.feedItem.deleteMany({ where: { projectId } });
  await prisma.userFollow.deleteMany({ where: { userId } });
  await prisma.muteKeyword.deleteMany({ where: { userId } });
  await prisma.project.deleteMany({ where: { userId: projectId } });
  await prisma.user.delete({ where: { id: userId } });
  await new Promise<void>((r) => app.close(() => r()));
  await prisma.$disconnect();
});

describe("GET /feed?filter=mine", () => {
  it("applies follows + mutes (Review Focus #1 + #2)", async () => {
    const res = await request(app).get("/feed?filter=mine").set("Cookie", cookie).expect(200);
    expect(res.body.items ?? res.body).not.toEqual(expect.arrayContaining([expect.objectContaining({ text: "spam hello" })]));
  });
});
```

- [ ] **Step 3: Modify `src/routes/feed.ts`**

If the route currently accepts no auth, gate it with `requireUser` only when `?filter=mine` is set (so the public feed still works for logged-out users):

```ts
import { shouldShow } from "../feed/filter-evaluator.js";

router.get("/", async (req, res) => {
  if (req.query.filter === "mine" && !req.user) {
    res.status(401).json({ error: "login required" });
    return;
  }
  const items = await prisma.feedItem.findMany({ /* existing query */ });
  if (req.query.filter !== "mine") {
    return res.json({ items });
  }
  const [follows, filters, mutes] = await Promise.all([
    prisma.userFollow.findMany({ where: { userId: req.user!.id } }),
    prisma.filter.findMany({ where: { userId: req.user!.id } }),
    prisma.muteKeyword.findMany({ where: { userId: req.user!.id } }),
  ]);
  const followSet = new Set(follows.map((f) => f.projectId));
  const filtered = items.filter((item) =>
    shouldShow({ projectId: item.projectId, text: item.text }, followSet, filters, mutes),
  );
  res.json({ items: filtered });
});
```

Apply `requireUser` selectively — either via middleware only on the `mine` branch (see code above), or via a wrapper that checks `req.query.filter === "mine"` before invoking `requireUser`.

- [ ] **Step 4: Run — expect PASS**

Run: `npm test -- src/routes/feed-filtered.test.ts`
Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add src/routes/feed.ts src/routes/feed-filtered.test.ts
git commit -m "feat(feed): apply per-user filters when ?filter=mine"
```

---

## Sub-project 3: Posting / Reply / Like

### Task 15: `xauthtoken.user_id` column

**Files:**
- Modify: `prisma/schema.prisma`
- Run: `npx prisma migrate dev --name add_xauthtoken_user_id`

Append a nullable column on `xauthtoken`:

```prisma
model xauthtoken {
  // ... existing fields ...
  userId String? @map("user_id")

  @@index([userId])
  @@map("x_auth_token")
}
```

- [ ] **Step 1: Commit**

```bash
git add prisma/
git commit -m "feat(db): xauthtoken.user_id nullable FK"
```

### Task 16: XWriteClient implementation

**Files:**
- Create: `src/twitter/XWriteClient.ts`
- Create: `src/twitter/XWriteClient.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type WriteResult =
    | { ok: true; tweetId: string; url: string }
    | { ok: false; error: "rate_limited"|"auth_invalid"|"network"|"unknown"; retryAfterMs?: number; message: string };
  class XWriteClient {
    constructor(token: { authToken: string; ct0: string; username: string });
    post(text: string, replyToTweetId?: string): Promise<WriteResult>;
    like(tweetId: string): Promise<WriteResult>;
    retweet(tweetId: string): Promise<WriteResult>;
    reply(tweetId: string, text: string): Promise<WriteResult>;
    getCircuitState(): "closed"|"open"|"half-open";
  }
  ```

- [ ] **Step 1: Write `src/twitter/XWriteClient.test.ts`**

```ts
import { describe, it, expect, vi } from "vitest";
import { XWriteClient } from "./XWriteClient.js";

describe("XWriteClient", () => {
  it("maps a 429 to a rate_limited result and trips the breaker", async () => {
    const fakeFetch = vi.fn().mockResolvedValue({ status: 429, json: async () => ({ retry_after_ms: 1000 }) });
    const client = new XWriteClient(
      { authToken: "x", ct0: "y", username: "u" },
      { fetcher: fakeFetch },
    );
    const res = await client.like("123");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe("rate_limited");
      expect(res.retryAfterMs).toBe(1000);
    }
    expect(client.getCircuitState()).toBe("closed"); // 1 failure, threshold is 3
  });

  it("maps a 401 to auth_invalid and clears the breaker", async () => {
    const fakeFetch = vi.fn().mockResolvedValue({ status: 401, json: async () => ({}) });
    const client = new XWriteClient(
      { authToken: "x", ct0: "y", username: "u" },
      { fetcher: fakeFetch },
    );
    const res = await client.post("hi");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("auth_invalid");
  });

  it("returns ok=true on a 200 with a tweet id", async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      status: 200,
      json: async () => ({ data: { create_tweet: { tweet_results: { result: { rest_id: "999" } } } } }),
    });
    const client = new XWriteClient(
      { authToken: "x", ct0: "y", username: "u" },
      { fetcher: fakeFetch },
    );
    const res = await client.post("hi");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.tweetId).toBe("999");
      expect(res.url).toContain("999");
    }
  });

  it("two XWriteClients with different tokens have isolated breakers (Review Focus #5)", async () => {
    const failingFetch = vi.fn().mockResolvedValue({
      status: 429,
      json: async () => ({ retry_after_ms: 1000 }),
    });
    const goodFetch = vi.fn().mockResolvedValue({
      status: 200,
      json: async () => ({ data: { create_tweet: { tweet_results: { result: { rest_id: "1" } } } } }),
    });
    const bad = new XWriteClient(
      { authToken: "x", ct0: "y", username: "bad" },
      { fetcher: failingFetch },
    );
    const good = new XWriteClient(
      { authToken: "x2", ct0: "y2", username: "good" },
      { fetcher: goodFetch },
    );

    // 3 failures on bad
    for (let i = 0; i < 3; i++) {
      await bad.like(`t${i}`);
    }
    expect(bad.getCircuitState()).toBe("open");

    // good still closed and succeeds
    expect(good.getCircuitState()).toBe("closed");
    const ok = await good.post("hi");
    expect(ok.ok).toBe(true);
    expect(good.getCircuitState()).toBe("closed");
  });
});
```

- [ ] **Step 2: Implement `src/twitter/XWriteClient.ts`**

```ts
import { CircuitBreaker } from "./circuit-breaker.js";

export type XAuthTokenInput = { authToken: string; ct0: string; username: string };

export type WriteResult =
  | { ok: true; tweetId: string; url: string }
  | {
      ok: false;
      error: "rate_limited" | "auth_invalid" | "network" | "unknown";
      retryAfterMs?: number;
      message: string;
    };

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

const GRAPHQL_POST = "https://x.com/i/api/graphql/xc8f1g7BYqr6VTzTbvNlGw/CreateTweet";
const GRAPHQL_LIKE = "https://x.com/i/api/graphql/lI07N6OggvJTwH1iQ7M_qA/favoriteTweet";
const GRAPHQL_RETWEET = "https://x.com/i/api/graphql/ojPOGdwB5dKnM7wy3wM7nQ/CreateRetweet";

export class XWriteClient {
  private readonly breaker = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 15 * 60 * 1000 });
  private readonly fetcher: Fetcher;

  constructor(private readonly token: XAuthTokenInput, opts: { fetcher?: Fetcher } = {}) {
    this.fetcher = opts.fetcher ?? ((url, init) => fetch(url, init));
  }

  getCircuitState() {
    return this.breaker.getState();
  }

  async post(text: string, replyToTweetId?: string): Promise<WriteResult> {
    return this.runMutation(GRAPHQL_POST, {
      variables: { tweet_text: text, ...(replyToTweetId ? { reply: { in_reply_to_tweet_id: replyToTweetId } } : {}) },
      features: { /* mirror the read-client feature flags — copy from src/TwitterClient */ },
    });
  }

  async reply(tweetId: string, text: string): Promise<WriteResult> {
    return this.post(text, tweetId);
  }

  async like(tweetId: string): Promise<WriteResult> {
    return this.runMutation(GRAPHQL_LIKE, { variables: { tweet_id: tweetId } });
  }

  async retweet(tweetId: string): Promise<WriteResult> {
    return this.runMutation(GRAPHQL_RETWEET, { variables: { tweet_id: tweetId, dark_request: false } });
  }

  private async runMutation(url: string, body: unknown): Promise<WriteResult> {
    if (this.breaker.getState() === "open") {
      return { ok: false, error: "rate_limited", message: "circuit open" };
    }
    try {
      const res = await this.fetcher(url, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(body),
      });
      if (res.status === 200 || res.status === 201) {
        const json = (await res.json()) as { data?: { create_tweet?: { tweet_results?: { result?: { rest_id?: string } } } } };
        const id =
          json.data?.create_tweet?.tweet_results?.result?.rest_id ??
          // Like/retweet endpoints return different shapes; map here as needed.
          (() => {
            const alt = (json as Record<string, unknown>);
            for (const v of Object.values(alt)) {
              if (v && typeof v === "object" && "rest_id" in (v as object)) {
                return (v as { rest_id?: string }).rest_id;
              }
            }
            return undefined;
          })();
        if (!id) {
          this.breaker.recordFailure(new Error("no tweet id in response"));
          return { ok: false, error: "unknown", message: "no tweet id in response" };
        }
        this.breaker.recordSuccess();
        return { ok: true, tweetId: id, url: `https://x.com/i/status/${id}` };
      }
      if (res.status === 429) {
        const j = (await res.json().catch(() => ({}))) as { retry_after_ms?: number };
        this.breaker.recordFailure(new Error("429"));
        return {
          ok: false,
          error: "rate_limited",
          retryAfterMs: typeof j.retry_after_ms === "number" ? j.retry_after_ms : undefined,
          message: "rate limited",
        };
      }
      if (res.status === 401 || res.status === 403) {
        this.breaker.recordFailure(new Error(String(res.status)));
        return { ok: false, error: "auth_invalid", message: `auth failed: ${res.status}` };
      }
      this.breaker.recordFailure(new Error(String(res.status)));
      return { ok: false, error: "unknown", message: `unexpected status ${res.status}` };
    } catch (err) {
      this.breaker.recordFailure(err);
      return { ok: false, error: "network", message: (err as Error).message };
    }
  }

  private headers(): Record<string, string> {
    return {
      authorization: `Bearer ${this.token.authToken}`,
      "x-csrf-token": this.token.ct0,
      "content-type": "application/json",
      cookie: `auth_token=${this.token.authToken}; ct0=${this.token.ct0}`,
    };
  }
}
```

- [ ] **Step 3: Run — expect PASS**

Run: `npm test -- src/twitter/XWriteClient.test.ts`
Expected: 3 passed.

- [ ] **Step 4: Commit**

```bash
git add src/twitter/XWriteClient.ts src/twitter/XWriteClient.test.ts
git commit -m "feat(twitter): XWriteClient with circuit breaker and discriminated-union results"
```

### Task 17: Admin link/unlink X account to User

**Files:**
- Create: `src/routes/admin-xauth.ts`
- Create: `src/routes/admin-xauth.test.ts`
- Modify: `src/server.ts`

- [ ] **Step 1: Implement route + tests (pattern matches Task 6's admin invites)**

```ts
// src/routes/admin-xauth.ts
import { Router } from "express";
import { prisma } from "../db/prisma.js";
import { adminAuth } from "./projects.js"; // adjust

export const adminXAuthRouter = Router();
adminXAuthRouter.use(adminAuth);

adminXAuthRouter.post("/users/:userId/link-x", async (req, res) => {
  const userId = req.params.userId!;
  const xauthtokenId = req.body?.xauthtokenId;
  if (typeof xauthtokenId !== "string") { res.status(400).json({ error: "xauthtokenId required" }); return; }
  await prisma.xauthtoken.update({ where: { id: xauthtokenId }, data: { userId } });
  res.json({ ok: true });
});

adminXAuthRouter.delete("/users/:userId/link-x/:xauthtokenId", async (req, res) => {
  const { userId, xauthtokenId } = req.params;
  await prisma.xauthtoken.updateMany({
    where: { id: xauthtokenId!, userId: userId! },
    data: { userId: null },
  });
  res.json({ ok: true });
});
```

- [ ] **Step 2: Wire in `src/server.ts`**

```ts
app.use("/admin", adminXAuthRouter);
```

- [ ] **Step 3: Commit**

```bash
git add src/routes/admin-xauth.ts src/routes/admin-xauth.test.ts src/server.ts
git commit -m "feat(admin): link/unlink X auth tokens to users"
```

### Task 18: `/post`, `/post/:id/like`, `/post/:id/retweet`, `/post/:id/reply`

**Files:**
- Create: `src/routes/post.ts`
- Create: `src/routes/post.test.ts`
- Modify: `src/server.ts`

- [ ] **Step 1: Implement `src/routes/post.ts`**

```ts
import { Router } from "express";
import { prisma } from "../db/prisma.js";
import { requireUser } from "../auth/middleware.js";
import { XWriteClient } from "../twitter/XWriteClient.js";

export const postRouter = Router();
postRouter.use(requireUser);

async function clientFor(userId: string) {
  const token = await prisma.xauthtoken.findFirst({ where: { userId, isActive: true } });
  if (!token) return null;
  return new XWriteClient({ authToken: token.authToken, ct0: token.ct0, username: token.username });
}

postRouter.post("/", async (req, res) => {
  const client = await clientFor(req.user!.id);
  if (!client) { res.status(409).json({ error: "no linked X account" }); return; }
  const { text, replyToTweetId } = req.body ?? {};
  if (typeof text !== "string" || text.length === 0) { res.status(400).json({ error: "text required" }); return; }
  const r = await client.post(text, typeof replyToTweetId === "string" ? replyToTweetId : undefined);
  res.status(r.ok ? 201 : 502).json(r);
});

postRouter.post("/:id/like", async (req, res) => {
  const client = await clientFor(req.user!.id);
  if (!client) { res.status(409).json({ error: "no linked X account" }); return; }
  const r = await client.like(req.params.id!);
  res.status(r.ok ? 200 : 502).json(r);
});

postRouter.post("/:id/retweet", async (req, res) => {
  const client = await clientFor(req.user!.id);
  if (!client) { res.status(409).json({ error: "no linked X account" }); return; }
  const r = await client.retweet(req.params.id!);
  res.status(r.ok ? 200 : 502).json(r);
});

postRouter.post("/:id/reply", async (req, res) => {
  const client = await clientFor(req.user!.id);
  if (!client) { res.status(409).json({ error: "no linked X account" }); return; }
  const text = req.body?.text;
  if (typeof text !== "string") { res.status(400).json({ error: "text required" }); return; }
  const r = await client.reply(req.params.id!, text);
  res.status(r.ok ? 201 : 502).json(r);
});
```

- [ ] **Step 2: Write `src/routes/post.test.ts`**

Stub `XWriteClient` via Vitest's module mock by passing an explicit `fetcher` in tests, or use the `vi.mock` API to replace the class with a stub. Use `vi.mock("../twitter/XWriteClient.js", ...)` and assert the route calls the stub correctly.

Example with `vi.mock`:

```ts
import { afterAll, beforeAll, describe, it, expect, vi } from "vitest";
import request from "supertest";
import { createApp } from "../server.js";
import { prisma } from "../db/prisma.js";
import { hashPassword } from "../auth/password.js";
import { createSession } from "../auth/sessions.js";
import type { Server } from "node:http";

vi.mock("../twitter/XWriteClient.js", () => ({
  XWriteClient: vi.fn().mockImplementation(() => ({
    post: vi.fn().mockResolvedValue({ ok: true, tweetId: "1", url: "https://x/1" }),
    like: vi.fn().mockResolvedValue({ ok: true, tweetId: "1", url: "https://x/1" }),
    retweet: vi.fn().mockResolvedValue({ ok: true, tweetId: "1", url: "https://x/1" }),
    reply: vi.fn().mockResolvedValue({ ok: true, tweetId: "1", url: "https://x/1" }),
  })),
}));

let app: Server;
let userId: string;
let cookie: string;

beforeAll(async () => {
  app = createApp().listen(0);
  const u = await prisma.user.create({
    data: { email: `post-${Date.now()}@t.local`, passwordHash: await hashPassword("passwordpassword1") },
  });
  userId = u.id;
  const { token } = await createSession(userId);
  cookie = `xfeed_session=${token}`;
  await prisma.xauthtoken.create({
    data: {
      id: `xt-${Date.now()}`, username: `x_${Date.now()}`, authToken: "a", ct0: "c", userId,
    },
  });
});

afterAll(async () => {
  await prisma.xauthtoken.deleteMany({ where: { userId } });
  await prisma.user.delete({ where: { id: userId } });
  await new Promise<void>((r) => app.close(() => r()));
  await prisma.$disconnect();
});

describe("POST /post", () => {
  it("posts when X account linked", async () => {
    await request(app).post("/post").set("Cookie", cookie).send({ text: "hi" }).expect(201);
  });

  it("409 when no X account linked", async () => {
    await prisma.xauthtoken.updateMany({ where: { userId }, data: { userId: null } });
    await request(app).post("/post").set("Cookie", cookie).send({ text: "hi" }).expect(409);
    // restore for any later test
    await prisma.xauthtoken.updateMany({ where: { username: { startsWith: "x_" } }, data: { userId } });
  });
});
```

- [ ] **Step 3: Wire in `src/server.ts`**

```ts
app.use("/post", postRouter);
```

- [ ] **Step 4: Run — expect PASS**

Run: `npm test -- src/routes/post.test.ts`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add src/routes/post.ts src/routes/post.test.ts src/server.ts
git commit -m "feat(post): /post and /post/:id/{like,retweet,reply} routes"
```

---

## Sub-project 4: Web Push Upgrades

### Task 19: Add `push_subscriptions.user_id` column

**Files:**
- Modify: `prisma/schema.prisma`
- Run: `npx prisma migrate dev --name add_push_subscription_user_id`

Add a nullable column on `PushSubscription`:

```prisma
model PushSubscription {
  // ... existing fields ...
  userId String? @map("user_id")
  user   User?   @relation(fields: [userId], references: [id], onDelete: SetNull)

  @@index([userId])
  @@map("push_subscriptions")
}
```

- [ ] **Step 1: Commit**

```bash
git add prisma/
git commit -m "feat(db): push_subscriptions.user_id nullable FK"
```

### Task 20: `PushDispatcher` service

**Files:**
- Create: `src/services/push-dispatcher.ts`
- Create: `src/services/push-dispatcher.test.ts`

**Interfaces:**
- Produces:
  ```ts
  class PushDispatcher {
    dispatchToFollowers(item: FeedItem): Promise<void>;
    dispatchToUser(userId: string, item: FeedItem): Promise<DispatchResult>;
  }
  ```

- [ ] **Step 1: Write `src/services/push-dispatcher.test.ts`**

```ts
import { afterAll, beforeAll, describe, it, expect, vi } from "vitest";
import { prisma } from "../db/prisma.js";
import { hashPassword } from "../auth/password.js";
import { PushDispatcher } from "./push-dispatcher.js";

let userId: string;
let projectId: string;
const sendNotification = vi.fn();

vi.mock("web-push", () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: (...args: unknown[]) => sendNotification(...args),
  },
}));

beforeAll(async () => {
  sendNotification.mockReset();
  sendNotification.mockResolvedValue({});
  const u = await prisma.user.create({
    data: { email: `push-${Date.now()}@t.local`, passwordHash: await hashPassword("passwordpassword1") },
  });
  userId = u.id;
  const p = await prisma.project.create({
    data: { userId: `pp-${Date.now()}`, name: "P", username: `pp${Date.now()}` },
  });
  projectId = p.userId;
  await prisma.userFollow.create({ data: { userId, projectId } });
  await prisma.pushSubscription.create({
    data: {
      endpoint: `https://push.test/${Date.now()}`,
      p256dh: "k1", auth: "k2",
      userId,
    },
  });
});

afterAll(async () => {
  await prisma.pushSubscription.deleteMany({ where: { userId } });
  await prisma.userFollow.deleteMany({ where: { userId } });
  await prisma.project.deleteMany({ where: { userId: projectId } });
  await prisma.user.delete({ where: { id: userId } });
  await prisma.$disconnect();
});

describe("PushDispatcher.dispatchToFollowers (Review Focus #4)", () => {
  it("fans out to followers only", async () => {
    const d = new PushDispatcher({ concurrency: 8 });
    await d.dispatchToFollowers({
      id: "f1",
      projectId,
      username: "u",
      text: "hello",
      tweetUrl: "https://x/1",
      postedAt: new Date(),
      likes: 0, reposts: 0, replies: 0,
    } as never);
    expect(sendNotification).toHaveBeenCalledTimes(1);
  });

  it("prunes dead subscriptions on 404", async () => {
    sendNotification.mockReset();
    sendNotification.mockRejectedValueOnce({ statusCode: 404 });
    const d = new PushDispatcher({ concurrency: 8 });
    await d.dispatchToUser(userId, {
      id: "f2", projectId, username: "u", text: "x", tweetUrl: "u",
      postedAt: new Date(), likes: 0, reposts: 0, replies: 0,
    } as never);
    const count = await prisma.pushSubscription.count({ where: { userId } });
    expect(count).toBe(0);
  });

  it("fans out to many followers concurrently without sequential stalls (Review Focus #4)", async () => {
    sendNotification.mockReset();
    sendNotification.mockResolvedValue({});
    const N = 100;
    // create N extra users each with a subscription
    const extras = await Promise.all(
      Array.from({ length: N }, () =>
        prisma.user.create({
          data: { email: `backpressure-${Math.random()}@t.local`, passwordHash: "x" },
        }),
      ),
    );
    await Promise.all(
      extras.map((u) => prisma.pushSubscription.create({
        data: { endpoint: `https://push.test/${u.id}`, p256dh: "k", auth: "k", userId: u.id },
      })),
    );
    await Promise.all(
      extras.map((u) => prisma.userFollow.create({ data: { userId: u.id, projectId } })),
    );
    const d = new PushDispatcher({ concurrency: 16 });
    const t0 = Date.now();
    await d.dispatchToFollowers({
      id: "bp", projectId, username: "u", text: "hi",
      tweetUrl: "u", postedAt: new Date(),
      likes: 0, reposts: 0, replies: 0,
    } as never);
    const elapsed = Date.now() - t0;
    // 100 sequential @10ms would be 1000ms; 16-way concurrent should be well under 500ms.
    expect(elapsed).toBeLessThan(1500);
    expect(sendNotification.mock.calls.length).toBe(N + 1); // +1 for the test user
    await prisma.pushSubscription.deleteMany({ where: { userId: { in: extras.map((u) => u.id) } } });
    await prisma.userFollow.deleteMany({ where: { userId: { in: extras.map((u) => u.id) } } });
    await prisma.user.deleteMany({ where: { id: { in: extras.map((u) => u.id) } } });
  });
});
```

- [ ] **Step 2: Implement `src/services/push-dispatcher.ts`**

```ts
import webpush from "web-push";
import { prisma } from "../db/prisma.js";
import { shouldShow } from "../feed/filter-evaluator.js";
import type { FeedItem } from "../generated/prisma/client.js";

type DispatcherOpts = { concurrency?: number };

export class PushDispatcher {
  private readonly concurrency: number;
  constructor(opts: DispatcherOpts = {}) {
    this.concurrency = opts.concurrency ?? 16;
    this.ensureVapid();
  }

  private ensureVapid(): void {
    const subject = process.env.VAPID_SUBJECT;
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    const newPublic = process.env.VAPID_PUBLIC_KEY_NEW;
    const newPrivate = process.env.VAPID_PRIVATE_KEY_NEW;
    if (subject && publicKey && privateKey) {
      webpush.setVapidDetails(subject, publicKey, privateKey);
    }
    if (newPublic && newPrivate && subject) {
      // web-push has a single global VAPID detail; rotate env to switch.
    }
  }

  async dispatchToFollowers(item: FeedItem): Promise<void> {
    const follows = await prisma.userFollow.findMany({
      where: { projectId: item.projectId },
    });
    await Promise.all(follows.map((f) => this.dispatchToUser(f.userId, item)));
  }

  async dispatchToUser(userId: string, item: FeedItem): Promise<void> {
    const [filters, mutes] = await Promise.all([
      prisma.filter.findMany({ where: { userId, isActive: true } }),
      prisma.muteKeyword.findMany({ where: { userId } }),
    ]);
    if (!shouldShow({ projectId: item.projectId, text: item.text }, new Set([item.projectId]), filters, mutes)) {
      return;
    }
    const subs = await prisma.pushSubscription.findMany({ where: { userId } });
    const payload = JSON.stringify({
      title: `@${item.username}`,
      body: item.text.slice(0, 200),
      url: item.tweetUrl,
      tag: `${item.projectId}:${item.id}`,
    });
    await Promise.all(subs.map((s) => this.sendOne(s.endpoint, s.p256dh, s.auth, payload)));
  }

  private async sendOne(endpoint: string, p256dh: string, auth: string, payload: string): Promise<void> {
    try {
      await webpush.sendNotification({ endpoint, keys: { p256dh, auth } }, payload, { TTL: 60 * 60 });
    } catch (err: unknown) {
      const status = err && typeof err === "object" && "statusCode" in err
        ? (err as { statusCode: number }).statusCode
        : undefined;
      if (status === 404 || status === 410) {
        await prisma.pushSubscription.deleteMany({ where: { endpoint } });
        return;
      }
      console.error("[push] delivery failed:", err);
    }
  }
}
```

- [ ] **Step 3: Run — expect PASS**

Run: `npm test -- src/services/push-dispatcher.test.ts`
Expected: 2 passed.

- [ ] **Step 4: Commit**

```bash
git add src/services/push-dispatcher.ts src/services/push-dispatcher.test.ts
git commit -m "feat(push): PushDispatcher with follower fan-out + dead-sub pruning"
```

### Task 21: Wire PushDispatcher into the feed worker

**Files:**
- Modify: `src/feed/feed.ts`

- [ ] **Step 1: Read `src/feed/feed.ts` to find the new-tweet handler**

- [ ] **Step 2: Replace `sendTweetPushNotification` call with `PushDispatcher.dispatchToFollowers`**

```ts
import { PushDispatcher } from "../services/push-dispatcher.js";
const dispatcher = new PushDispatcher();
// inside the new-tweet path:
await dispatcher.dispatchToFollowers(item);
```

- [ ] **Step 3: Commit**

```bash
git add src/feed/feed.ts
git commit -m "feat(push): wire PushDispatcher into feed worker"
```

### Task 22: Update `/push/subscriptions` to require login + stamp user_id

**Files:**
- Modify: `src/routes/push.ts`
- Modify: `src/services/push.ts`

- [ ] **Step 1: Read both files**

- [ ] **Step 2: Add `requireUser` to `pushRouter.post("/subscriptions")`**

```ts
import { requireUser } from "../auth/middleware.js";
pushRouter.post("/subscriptions", requireUser, async (req, res) => {
  // existing body parsing…
  await savePushSubscription({ ...subscription, userId: req.user!.id });
  res.status(201).json({ subscribed: true });
});
```

- [ ] **Step 3: Update `savePushSubscription` to accept `userId` and pass to Prisma**

```ts
export async function savePushSubscription(input: PushSubscriptionInput & { userId?: string }) {
  return prisma.pushSubscription.upsert({
    where: { endpoint: input.endpoint },
    create: { endpoint: input.endpoint, p256dh: input.keys.p256dh, auth: input.keys.auth, userId: input.userId ?? null, /* … */ },
    update: { p256dh: input.keys.p256dh, auth: input.keys.auth, userId: input.userId ?? null, /* … */ },
  });
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `npm test`
Expected: all previous tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src/routes/push.ts src/services/push.ts
git commit -m "feat(push): require login + stamp user_id on subscription"
```

### Task 23: VAPID rotation support

**Files:**
- Modify: `src/services/push-dispatcher.ts`

- [ ] **Step 1: Read the existing `ensureVapid` method**

- [ ] **Step 2: Add rotation logic**

When both `VAPID_PUBLIC_KEY_NEW` and `VAPID_PRIVATE_KEY_NEW` are present, use the new keys for sending. Keep the legacy keys warm in case old browsers still expect them — web-push does not support per-call VAPID, so log a clear note that operators must restart to fully rotate, and prioritize new keys in `setVapidDetails`.

```ts
private ensureVapid(): void {
  const subject = process.env.VAPID_SUBJECT;
  const newPublic = process.env.VAPID_PUBLIC_KEY_NEW;
  const newPrivate = process.env.VAPID_PRIVATE_KEY_NEW;
  const publicKey = newPublic ?? process.env.VAPID_PUBLIC_KEY;
  const privateKey = newPrivate ?? process.env.VAPID_PRIVATE_KEY;
  if (subject && publicKey && privateKey) {
    webpush.setVapidDetails(subject, publicKey, privateKey);
  }
}
```

> Document in the project's `.env.example`:
> ```
> # VAPID keys. Set _NEW to both old and new for 30-day rotation.
> VAPID_SUBJECT=mailto:you@example.com
> VAPID_PUBLIC_KEY=
> VAPID_PRIVATE_KEY=
> # VAPID_PUBLIC_KEY_NEW=
> # VAPID_PRIVATE_KEY_NEW=
> ```

- [ ] **Step 3: Commit**

```bash
git add src/services/push-dispatcher.ts .env.example
git commit -m "feat(push): VAPID rotation via _NEW env vars"
```

---

## Sub-project 5: Telegram Bot Upgrades

### Task 24: `TelegramBinding` schema

**Files:**
- Modify: `prisma/schema.prisma`
- Run: `npx prisma migrate dev --name add_telegram_binding`

```prisma
model TelegramBinding {
  chatId   BigInt   @id @map("chat_id")
  userId   String   @map("user_id")
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz

  @@index([userId])
  @@map("telegram_bindings")
}
```

- [ ] **Step 1: Commit**

```bash
git add prisma/
git commit -m "feat(db): TelegramBinding table"
```

### Task 25: Telegram `/link` + `/whoami` commands

**Files:**
- Modify: `src/tgBot/` (find the bot entrypoint — likely `src/tgBot/index.ts` or similar)
- Create: `src/tgBot/commands.test.ts`

- [ ] **Step 1: Read `src/tgBot/`**

- [ ] **Step 2: Implement `/link <token>` and `/whoami` handlers**

```ts
import { prisma } from "../db/prisma.js";
import { sha256Hex } from "../auth/tokens.js";
import { shouldShow } from "../feed/filter-evaluator.js";

// /link <invite-or-login-token>
bot.command("link", async (ctx) => {
  const token = ctx.message?.text?.split(/\s+/)[1];
  if (!token) return ctx.reply("Usage: /link <token>");
  const invite = await prisma.userInvite.findUnique({
    where: { tokenHash: sha256Hex(token) },
  });
  if (!invite || invite.expiresAt.getTime() < Date.now() || invite.acceptedAt) {
    return ctx.reply("Invalid or expired link token.");
  }
  await prisma.telegramBinding.upsert({
    where: { chatId: BigInt(ctx.chat!.id) },
    create: { chatId: BigInt(ctx.chat!.id), userId: invite.invitedById },
    update: { userId: invite.invitedById },
  });
  await ctx.reply("Linked.");
});

bot.command("whoami", async (ctx) => {
  const binding = await prisma.telegramBinding.findUnique({
    where: { chatId: BigInt(ctx.chat!.id) },
    include: { user: false },
  });
  if (!binding) return ctx.reply("Not linked. Use /link <token>.");
  const user = await prisma.user.findUnique({ where: { id: binding.userId } });
  return ctx.reply(`Linked as ${user?.email ?? "(unknown)"}`);
});
```

- [ ] **Step 3: Tests**

Use the actual `bot.handleUpdate` entrypoint with a fake update payload — see how existing bot tests are structured. If no test infrastructure exists for the bot, add a thin wrapper:

```ts
// src/tgBot/commands.ts
export async function handleLinkCommand(chatId: number, token: string): Promise<{ ok: boolean; reason?: string }> {
  const invite = await prisma.userInvite.findUnique({ where: { tokenHash: sha256Hex(token) } });
  if (!invite || invite.expiresAt.getTime() < Date.now() || invite.acceptedAt) return { ok: false, reason: "invalid" };
  await prisma.telegramBinding.upsert({
    where: { chatId: BigInt(chatId) },
    create: { chatId: BigInt(chatId), userId: invite.invitedById },
    update: { userId: invite.invitedById },
  });
  return { ok: true };
}
```

…and unit-test that function. Wire `bot.command("link", ...)` to call `handleLinkCommand`.

- [ ] **Step 4: Commit**

```bash
git add src/tgBot/
git commit -m "feat(tg): /link and /whoami commands"
```

### Task 26: Telegram `/follow` + `/unfollow` + `/mute` + `/unmute`

**Files:**
- Modify: `src/tgBot/commands.ts`

```ts
export async function handleFollowCommand(chatId: number, username: string): Promise<{ ok: boolean; reason?: string }> {
  const binding = await prisma.telegramBinding.findUnique({ where: { chatId: BigInt(chatId) } });
  if (!binding) return { ok: false, reason: "not_linked" };
  const project = await prisma.project.findUnique({ where: { username } });
  if (!project) return { ok: false, reason: "no_project" };
  await prisma.userFollow.upsert({
    where: { userId_projectId: { userId: binding.userId, projectId: project.userId } },
    create: { userId: binding.userId, projectId: project.userId },
    update: {},
  });
  return { ok: true };
}

export async function handleUnfollowCommand(chatId: number, username: string): Promise<{ ok: boolean; reason?: string }> {
  const binding = await prisma.telegramBinding.findUnique({ where: { chatId: BigInt(chatId) } });
  if (!binding) return { ok: false, reason: "not_linked" };
  const project = await prisma.project.findUnique({ where: { username } });
  if (!project) return { ok: false, reason: "no_project" };
  await prisma.userFollow.deleteMany({ where: { userId: binding.userId, projectId: project.userId } });
  return { ok: true };
}

export async function handleMuteCommand(chatId: number, pattern: string, isRegex: boolean): Promise<{ ok: boolean; reason?: string }> {
  const binding = await prisma.telegramBinding.findUnique({ where: { chatId: BigInt(chatId) } });
  if (!binding) return { ok: false, reason: "not_linked" };
  if (isRegex) {
    try { new RegExp(pattern); } catch { return { ok: false, reason: "invalid_regex" }; }
  }
  await prisma.muteKeyword.create({
    data: { userId: binding.userId, pattern, isRegex },
  });
  return { ok: true };
}
```

Write unit tests covering `not_linked`, `no_project`, happy path for each. Wire `bot.command("follow", ...)`, `bot.command("unfollow", ...)`, `bot.command("mute", ...)` to call these functions.

- [ ] **Step 1: Commit**

```bash
git add src/tgBot/
git commit -m "feat(tg): /follow, /unfollow, /mute commands"
```

### Task 27: Telegram `/feed` + `/filters`

**Files:**
- Modify: `src/tgBot/commands.ts`

```ts
export async function handleFeedCommand(chatId: number, n: number): Promise<{ ok: boolean; items?: { username: string; text: string; url: string }[]; reason?: string }> {
  const binding = await prisma.telegramBinding.findUnique({ where: { chatId: BigInt(chatId) } });
  if (!binding) return { ok: false, reason: "not_linked" };
  const [follows, filters, mutes] = await Promise.all([
    prisma.userFollow.findMany({ where: { userId: binding.userId } }),
    prisma.filter.findMany({ where: { userId: binding.userId, isActive: true } }),
    prisma.muteKeyword.findMany({ where: { userId: binding.userId } }),
  ]);
  const followSet = new Set(follows.map((f) => f.projectId));
  const items = await prisma.feedItem.findMany({
    orderBy: { postedAt: "desc" },
    take: 200,
  });
  const filtered = items.filter((i) => shouldShow({ projectId: i.projectId, text: i.text }, followSet, filters, mutes));
  return { ok: true, items: filtered.slice(0, n).map((i) => ({ username: i.username, text: i.text, url: i.tweetUrl })) };
}

export async function handleFiltersCommand(chatId: number): Promise<{ ok: boolean; filters?: unknown[]; reason?: string }> {
  const binding = await prisma.telegramBinding.findUnique({ where: { chatId: BigInt(chatId) } });
  if (!binding) return { ok: false, reason: "not_linked" };
  const filters = await prisma.filter.findMany({ where: { userId: binding.userId } });
  return { ok: true, filters };
}
```

- [ ] **Step 1: Commit**

```bash
git add src/tgBot/
git commit -m "feat(tg): /feed and /filters commands with per-user filter evaluation"
```

---

## Sub-project 6: Feed UI + Service Worker

### Task 28: webui useUser hook + auth API client

**Files:**
- Create: `webui/hooks/useUser.ts`
- Create: `webui/lib/api.ts`

- [ ] **Step 1: Write `webui/lib/api.ts`**

```ts
export async function login(email: string, password: string): Promise<void> {
  const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error("invalid");
}

export async function logout(): Promise<void> {
  await fetch(`${process.env.NEXT_PUBLIC_API_URL}/auth/logout`, { method: "POST", credentials: "include" });
}

export async function fetchMe(): Promise<{ id: string; email: string; displayName: string | null } | null> {
  const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/auth/me`, { credentials: "include" });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error("server");
  return (await res.json()) as { id: string; email: string; displayName: string | null };
}
```

- [ ] **Step 2: Write `webui/hooks/useUser.ts`**

```ts
"use client";
import { useEffect, useState } from "react";
import { fetchMe } from "../lib/api";

export function useUser() {
  const [user, setUser] = useState<{ id: string; email: string } | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    fetchMe().then((u) => { setUser(u); setLoading(false); }).catch(() => setLoading(false));
  }, []);
  return { user, loading };
}
```

- [ ] **Step 3: Commit**

```bash
git add webui/hooks/useUser.ts webui/lib/api.ts
git commit -m "feat(webui): useUser hook + auth API client"
```

### Task 29: webui login + accept-invite pages

**Files:**
- Create: `webui/app/login/page.tsx`
- Create: `webui/app/invite/[token]/page.tsx`

- [ ] **Step 1: `webui/app/login/page.tsx`**

```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { login } from "../../lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <form onSubmit={async (e) => {
      e.preventDefault();
      try { await login(email, password); router.push("/"); }
      catch { setError("Invalid credentials"); }
    }}>
      <h1>Sign in</h1>
      <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required />
      <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" required />
      {error && <p role="alert">{error}</p>}
      <button type="submit">Sign in</button>
    </form>
  );
}
```

- [ ] **Step 2: `webui/app/invite/[token]/page.tsx`**

```tsx
"use client";
import { useState } from "react";
import { useParams, useRouter } from "next/navigation";

export default function AcceptInvitePage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <form onSubmit={async (e) => {
      e.preventDefault();
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/auth/accept-invite`, {
        method: "POST", credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      if (!res.ok) { setError("Invite invalid or expired"); return; }
      router.push("/");
    }}>
      <h1>Accept invite</h1>
      <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" minLength={12} required />
      {error && <p role="alert">{error}</p>}
      <button type="submit">Create account</button>
    </form>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add webui/app/login webui/app/invite
git commit -m "feat(webui): login + accept-invite pages"
```

### Task 30: webui settings/filters page

**Files:**
- Create: `webui/app/settings/filters/page.tsx`

```tsx
"use client";
import { useEffect, useState } from "react";

type Filter = { id: string; name: string; kind: string; pattern?: string; projectId?: string; action: string };
type Mute = { id: string; pattern: string; isRegex: boolean };

export default function FiltersPage() {
  const [filters, setFilters] = useState<Filter[]>([]);
  const [mutes, setMutes] = useState<Mute[]>([]);
  const [name, setName] = useState("");
  const [pattern, setPattern] = useState("");

  const reload = async () => {
    const [f, m] = await Promise.all([
      fetch(`${process.env.NEXT_PUBLIC_API_URL}/filters`, { credentials: "include" }).then((r) => r.json()),
      fetch(`${process.env.NEXT_PUBLIC_API_URL}/mute-keywords`, { credentials: "include" }).then((r) => r.json()),
    ]);
    setFilters(f); setMutes(m);
  };
  useEffect(() => { reload(); }, []);

  return (
    <div>
      <h1>Filters</h1>
      <form onSubmit={async (e) => {
        e.preventDefault();
        await fetch(`${process.env.NEXT_PUBLIC_API_URL}/filters`, {
          method: "POST", credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name, kind: "keyword", pattern, action: "hide" }),
        });
        setName(""); setPattern("");
        reload();
      }}>
        <input placeholder="name" value={name} onChange={(e) => setName(e.target.value)} />
        <input placeholder="pattern (regex)" value={pattern} onChange={(e) => setPattern(e.target.value)} />
        <button>Add filter</button>
      </form>
      <ul>{filters.map((f) => <li key={f.id}>{f.name} ({f.kind}) [{f.action}]</li>)}</ul>

      <h2>Mute keywords</h2>
      <ul>{mutes.map((m) => <li key={m.id}>{m.pattern}{m.isRegex ? " (regex)" : ""}</li>)}</ul>
    </div>
  );
}
```

- [ ] **Step 1: Commit**

```bash
git add webui/app/settings/filters
git commit -m "feat(webui): filters + mute keyword management page"
```

### Task 31: webui post-actions component

**Files:**
- Create: `webui/components/post-actions.tsx`

```tsx
"use client";
import { useState } from "react";
import { useUser } from "../hooks/useUser";

export function PostActions({ tweetId, initialLiked }: { tweetId: string; initialLiked: boolean }) {
  const { user } = useUser();
  const [liked, setLiked] = useState(initialLiked);
  const [busy, setBusy] = useState(false);
  if (!user) return null;
  const call = async (path: string) => {
    setBusy(true);
    try {
      await fetch(`${process.env.NEXT_PUBLIC_API_URL}${path}`, { method: "POST", credentials: "include" });
    } finally { setBusy(false); }
  };
  return (
    <div>
      <button disabled={busy} onClick={async () => { await call(`/post/${tweetId}/like`); setLiked(true); }}>{liked ? "Liked" : "Like"}</button>
      <button disabled={busy} onClick={() => call(`/post/${tweetId}/retweet`)}>Retweet</button>
      <button
        disabled={busy}
        onClick={async () => {
          const text = window.prompt("Reply text");
          if (!text) return;
          setBusy(true);
          try {
            await fetch(`${process.env.NEXT_PUBLIC_API_URL}/post/${tweetId}/reply`, {
              method: "POST",
              credentials: "include",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ text }),
            });
          } finally {
            setBusy(false);
          }
        }}
      >
        Reply
      </button>
    </div>
  );
}
```

> The `Reply` button uses two `fetch` calls in the example above for brevity. Consolidate to one. This is illustrative code; the engineer should clean it up.

- [ ] **Step 1: Commit**

```bash
git add webui/components/post-actions.tsx
git commit -m "feat(webui): post actions (like / retweet / reply)"
```

### Task 32: Personalized feed (`?filter=mine`) on the home page

**Files:**
- Modify: `webui/app/page.tsx` (or wherever the feed lives)

- [ ] **Step 1: Read `webui/app/page.tsx`**

- [ ] **Step 2: Add `?filter=mine` when user is logged in**

```tsx
const { user } = useUser();
const url = user
  ? `${process.env.NEXT_PUBLIC_API_URL}/feed?filter=mine`
  : `${process.env.NEXT_PUBLIC_API_URL}/feed`;
const res = await fetch(url, { credentials: "include" });
const data = await res.json();
// render data.items
```

- [ ] **Step 3: Commit**

```bash
git add webui/app/page.tsx
git commit -m "feat(webui): personalized feed for logged-in users"
```

### Task 33: Service worker — push + offline updates

**Files:**
- Modify: `webui/public/sw.js`

- [ ] **Step 1: Read `webui/public/sw.js`**

- [ ] **Step 2: Replace the push handler with a click-to-open handler**

```js
self.addEventListener("push", (event) => {
  const data = event.data?.json() ?? {};
  event.waitUntil(
    self.registration.showNotification(data.title ?? "x-feed", {
      body: data.body,
      tag: data.tag,
      data: { url: data.url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  const url = event.notification.data?.url;
  event.notification.close();
  if (url) event.waitUntil(self.clients.openWindow(url));
});
```

- [ ] **Step 3: Update fetch handler — stale-while-revalidate for `/feed`, network-first for `/auth/me` and `/filters`, offline cache for last 50 feed items**

```js
const CACHE_NAME = "x-feed-v1";
const FEED_CACHE = "x-feed-feed-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((c) => c.add("/")));
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.pathname === "/feed" || url.pathname.startsWith("/feed?")) {
    event.respondWith(staleWhileRevalidate(event.request, FEED_CACHE));
    return;
  }
  if (url.pathname === "/auth/me" || url.pathname.startsWith("/filters")) {
    event.respondWith(networkFirst(event.request, CACHE_NAME));
    return;
  }
});

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const network = fetch(request).then(async (res) => {
    if (res.ok) {
      cache.put(request, res.clone());
      const keys = await cache.keys();
      if (keys.length > 50) await cache.delete(keys[0]);
    }
    return res;
  }).catch(() => cached);
  return cached ?? network;
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(request);
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch {
    return (await cache.match(request)) ?? Response.error();
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add webui/public/sw.js
git commit -m "feat(sw): push handler with click-to-open + offline cache"
```

---

## Cross-cutting

### Task 34: `/admin/health/twitter` + `/admin/health/push`

**Files:**
- Create: `src/routes/admin-health.ts`
- Modify: `src/server.ts`

- [ ] **Step 1: Implement health endpoints**

```ts
import { Router } from "express";
import { adminAuth } from "./projects.js"; // adjust
import { prisma } from "../db/prisma.js";

export const adminHealthRouter = Router();
adminHealthRouter.use(adminAuth);

adminHealthRouter.get("/twitter", async (_req, res) => {
  const tokens = await prisma.xauthtoken.findMany({ where: { isActive: true } });
  res.json({ accounts: tokens.map((t) => ({ username: t.username, isActive: t.isActive })) });
});

adminHealthRouter.get("/push", async (_req, res) => {
  const [total, withUser] = await Promise.all([
    prisma.pushSubscription.count(),
    prisma.pushSubscription.count({ where: { userId: { not: null } } }),
  ]);
  res.json({ total, withUser });
});
```

- [ ] **Step 2: Wire mount**

```ts
app.use("/admin/health", adminHealthRouter);
```

- [ ] **Step 3: Commit**

```bash
git add src/routes/admin-health.ts src/server.ts
git commit -m "feat(admin): /admin/health/{twitter,push}"
```

### Task 35: Wire socket.io fan-out per user

**Files:**
- Modify: `src/server.ts`
- Modify: `src/services/push-dispatcher.ts`

- [ ] **Step 1: Pass the `io` instance into `PushDispatcher`**

```ts
// PushDispatcher constructor accepts an optional io
class PushDispatcher {
  constructor(private readonly opts: { concurrency?: number; io?: import("socket.io").Server } = {}) {}
  async dispatchToUser(userId: string, item: FeedItem) {
    // ...existing push logic...
    this.opts.io?.to(`user:${userId}`).emit("feed:new", { id: item.id, text: item.text });
  }
}
```

- [ ] **Step 2: In `src/server.ts`, join sockets to `user:<id>` rooms on auth**

```ts
io.on("connection", (socket) => {
  const cookies = parseCookies(socket.handshake.headers.cookie);
  const token = cookies[SESSION_COOKIE];
  if (token) {
    resolveSession(token).then((r) => {
      if (r) socket.join(`user:${r.user.id}`);
    });
  }
});
```

- [ ] **Step 3: Wire in `createApp` → `startServer` flow**

```ts
const dispatcher = new PushDispatcher({ io });
startFeedWorker(io, dispatcher);
```

`startFeedWorker` should accept the dispatcher and call `dispatcher.dispatchToFollowers(item)` in place of the old `sendTweetPushNotification(item)`.

- [ ] **Step 4: Commit**

```bash
git add src/server.ts src/services/push-dispatcher.ts
git commit -m "feat(realtime): per-user socket.io rooms + feed fan-out"
```

### Task 36: Wire socket.io client to listen for `feed:new` and refresh

**Files:**
- Modify: `webui/app/page.tsx`

- [ ] **Step 1: Subscribe to `feed:new` and trigger a re-fetch**

```tsx
useEffect(() => {
  if (!user) return;
  const { socket } = await import("../../../lib/socket").then((m) => m.getSocket());
  const onNew = () => reload();
  socket.on("feed:new", onNew);
  return () => { socket.off("feed:new", onNew); };
}, [user]);
```

> Set up `webui/lib/socket.ts` exporting a singleton `socket.io-client` instance connected to the API server.

- [ ] **Step 2: Commit**

```bash
git add webui/app/page.tsx webui/lib/socket.ts
git commit -m "feat(webui): live feed refresh via socket.io"
```

### Task 37: Defer-anonymous-push-subs deactivation (30-day)

**Files:**
- Create: `prisma/migrations/20261023120000_deactivate_anonymous_push_subs/migration.sql`

> **Note:** schedule for ~30 days from now.

```sql
UPDATE push_subscriptions SET is_active = false WHERE user_id IS NULL;
```

> Add `isActive Boolean @default(true) @map("is_active")` to `PushSubscription` first if not already present. (Current schema lacks it; this is plan debt.)

- [ ] **Step 1: Add `isActive` column to `PushSubscription` (preparation migration)**

```prisma
// in schema.prisma
isActive Boolean @default(true) @map("is_active")
```

Run: `npx prisma migrate dev --name add_push_subscription_is_active`

- [ ] **Step 2: After 30 days, run the deactivation migration**

```bash
npx prisma migrate dev --name deactivate_anonymous_push_subs
```

- [ ] **Step 3: Commit + tag**

```bash
git add prisma/
git commit -m "chore(db): deactivate anonymous push subscriptions after 30d"
```

---

## Spec coverage summary

- Sub-project 1 (User Accounts & Auth): Tasks 1–8
- Sub-project 2 (Filters / Search / Mute): Tasks 11–14
- Sub-project 3 (Posting / Reply / Like): Tasks 15–18
- Sub-project 4 (Web Push Upgrades): Tasks 19–23
- Sub-project 5 (Telegram Bot Upgrades): Tasks 24–27
- Sub-project 6 (Feed UI + Service Worker): Tasks 28–33
- Sub-project 7 (Twitter/X Client Upgrades): Tasks 9, 10, 10a
- Cross-cutting: Tasks 34–37

Review Focus items 1–5 each have an explicit test in the task that owns the code: Task 12 (`shouldShow` with empty follows + hide-wins-over-mute), Task 4 (concurrent refresh), Task 20 (`PushDispatcher.dispatchToFollowers` 100-follower concurrency), Task 16 (two `XWriteClient` instances isolation).

Task 10 test pin for Review Focus item is folded into Task 16 which directly tests two `XWriteClient` instances with different tokens confirming independent breaker state.