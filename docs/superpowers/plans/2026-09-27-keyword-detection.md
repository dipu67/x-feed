# Keyword Detection ("Alpha" Alerts) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect keyword matches ("mint live", "whitelist", "gtd", …) on tweets at ingest, store them on the `FeedItem`, and surface them as feed badges + text highlights, a filtered "Alpha" view, gated/tagged web push, and Telegram alerts — with keywords managed in the webui.

**Architecture:** Persist-at-ingest (spec approach A). A pure matcher module classifies tweet text against enabled `Keyword` rows whenever `persistAndEmit` creates or updates a `FeedItem`, writing `matchedKeywords` (Json, `{phrase, tag}[]`) + `matchedCount` (int, filter index). Every consumer — socket events, `/feed` API, Alpha view, push gating, Telegram — reads only what is stored. One-time backfill classifies existing rows.

**Tech Stack:** Existing stack only — Express 5 + Prisma 7 (postgresql adapter) + socket.io backend (`src/`), Next.js webui (`webui/`), grammy (already installed), `node:test` run through tsx for the matcher (repo's first tests).

**Spec:** `docs/superpowers/specs/2026-09-27-keyword-detection-design.md` — read it before Task 1; the plan argues from it.

## Global Constraints

- **No new npm dependencies.** grammy, tsx, prisma are already installed; tests use `node:test`.
- Backend is **ESM with `.js` import specifiers** (`import { x } from "../lib/y.js"`) — match existing style.
- Backend type-check gate: `npm run build:api` (runs `tsc`). Webui gate: `cd webui && npx tsc --noEmit`.
- Dev backend port is **5500** (`http://localhost:5500`); webui proxies `/api/*` to it.
- Migrations: `npm run db:migrate -- --name <snake_name>` (prisma migrate dev). Regenerate client after schema edits: `npm run db:generate`.
- Prisma client import: `import { prisma } from "../db/prisma.js"`; generated namespace: `import { Prisma } from "../generated/prisma/client.js"`.
- Json null semantics: **DB NULL (`Prisma.DbNull`) = never classified** (pre-feature rows only); **JSON null (`Prisma.JsonNull`) = classified, no matches**; array = matches.
- Keyword phrases are stored **trimmed + lowercased** (matching is case-insensitive; uniqueness is therefore case-insensitive). Limits: phrase ≤ 100 chars, tag ≤ 30 chars.
- `Keyword.id` is `BigInt` — **never `res.json()` a prisma keyword row directly** (BigInt is not JSON-serializable); services map to `KeywordDTO` with `id: string`.
- Telegram env: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` — optional; when missing, log one warning and no-op (mirror the push service's VAPID pattern).
- Commit after every task (messages listed in each task). Do not commit unrelated working-tree changes (the repo may carry local edits in `webui/components/feed-item-card.tsx` / `growth-view.tsx` — stage files explicitly, never `git add -A`).

## Review Focus

The five input classes most likely to bite a user, each pinned to the task whose tests exercise it:

1. **Phrases containing regex metacharacters** (`"t+2"`, `"100x!"`) must match literally and never throw — pinned by Task 2 tests `regex metacharacters in phrases are literal (operators)` / `…(boundaries)`.
2. **Short tokens** (`"wl"`, `"gtd"`) must not match inside longer words (`"owls"`, `"xgtdx"`) but must match next to punctuation (`"wl!"`) — pinned by Task 2 tests `does not match inside longer words` / `matches adjacent to punctuation`.
3. **Duplicate phrase in any case** (`"Mint Live"` then `"mint live"`) must be a clean 409, not a 500 — pinned by Task 3 curl step (duplicate POST → `409`).
4. **Tweet edits that remove the keyword** must clear stale matches: the update path writes BOTH `matchedKeywords` and `matchedCount` every time — pinned by Task 5 code (update `data:` block) and smoke item 4 in Task 12.
5. **Alpha correctness**: `GET /feed?matched=1` must return only rows with real matches (never unclassified DB-NULL rows), and non-matching socket items must never enter the Alpha list — pinned by Task 6 curl step (unclassified row absent from `?matched=1`) and Task 6/9 code (where clause + handler filter).

---

### Task 1: Prisma schema — `keywords` table + `FeedItem` match columns

**Files:**
- Modify: `prisma/schema.prisma`
- Creates: `prisma/migrations/<ts>_keyword_detection/migration.sql` (via prisma)

**Interfaces:**
- Consumes: nothing.
- Produces: `prisma.keyword` model (fields: `id BigInt`, `phrase` unique, `tag String?`, `enabled Bool`, timestamps); `prisma.feedItem.matchedKeywords Json?` + `matchedCount Int @default(0)`; index `feed_items(matched_count, detected_at desc)`. Used by Tasks 3, 5, 6, 11.

- [ ] **Step 1: Add the `Keyword` model**

In `prisma/schema.prisma`, insert between the `PushSubscription` and `FeedItem` models:

```prisma
/// Operator-managed detection phrases. `phrase` is stored trimmed + lowercase;
/// matching is case-insensitive with word boundaries (see src/lib/keywords.ts).
model Keyword {
  id        BigInt   @id @default(autoincrement())
  phrase    String   @unique
  tag       String?
  enabled   Boolean  @default(true)
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz

  @@map("keywords")
}
```

- [ ] **Step 2: Add match columns + index to `FeedItem`**

In the `FeedItem` model, add after the `detectedAt` field:

```prisma
  /// { phrase, tag }[] matched at ingest; DB NULL = never classified,
  /// JSON null = classified with no matches (see Global Constraints).
  matchedKeywords Json? @map("matched_keywords")
  matchedCount    Int   @default(0) @map("matched_count")
```

And add this line to `FeedItem`'s `@@index` block (after `@@index([projectId, postedAt(sort: Desc)])`):

```prisma
  @@index([matchedCount, detectedAt(sort: Desc)])
```

- [ ] **Step 3: Migrate + regenerate**

Run: `npm run db:migrate -- --name keyword_detection && npm run db:generate`
Expected: prisma reports a migration applied (`keyword_detection`) and client regenerated into `src/generated/prisma`.

- [ ] **Step 4: Verify generated client exposes the model**

Run: `grep -rn "keywords" src/generated/prisma/models/Keyword.ts | head -3` (or `ls src/generated/prisma/models | grep -i keyword`)
Expected: a generated `Keyword` model file/exports exist.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(db): keywords table + feed item match columns"
```

---

### Task 2: Keyword matcher (TDD — repo's first tests)

**Files:**
- Create: `src/lib/keywords.ts`
- Test: `src/lib/keywords.test.ts`
- Modify: `package.json` (add `test` script)

**Interfaces:**
- Consumes: nothing (pure module).
- Produces (used by Tasks 5, 11):
  - `type MatchedKeyword = { phrase: string; tag: string | null }`
  - `type KeywordLike = { phrase: string; tag: string | null }`
  - `compileKeywordMatcher(keywords: KeywordLike[]): { match(text: string): MatchedKeyword[] }`

- [ ] **Step 1: Add the test script**

In root `package.json` scripts, replace the stub `"test": "echo \"Error: no test specified\" && exit 1"` with:

```json
    "test": "node --import tsx --test src/lib/keywords.test.ts",
```

- [ ] **Step 2: Write the failing tests**

Create `src/lib/keywords.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { compileKeywordMatcher } from "./keywords.js";

const kw = (phrase: string, tag: string | null = null) => ({ phrase, tag });

test("matches case-insensitively and returns the pair", () => {
  const matcher = compileKeywordMatcher([kw("mint live", "Mint")]);
  assert.deepEqual(matcher.match("The MINT LIVE is now open"), [
    { phrase: "mint live", tag: "Mint" },
  ]);
});

test("does not match inside longer words", () => {
  const matcher = compileKeywordMatcher([kw("gtd"), kw("wl")]);
  assert.deepEqual(matcher.match("xgtdx owls everywhere"), []);
});

test("matches adjacent to punctuation", () => {
  const matcher = compileKeywordMatcher([kw("wl", "WL")]);
  assert.deepEqual(matcher.match("wl! get yours"), [
    { phrase: "wl", tag: "WL" },
  ]);
});

test("regex metacharacters in phrases are literal (operators)", () => {
  const matcher = compileKeywordMatcher([kw("t+2")]);
  assert.deepEqual(matcher.match("round opens at t+2 tomorrow"), [
    { phrase: "t+2", tag: null },
  ]);
  assert.deepEqual(matcher.match("round opens at ttt2 tomorrow"), []);
});

test("regex metacharacters in phrases are literal (boundaries)", () => {
  const matcher = compileKeywordMatcher([kw("100x")]);
  assert.deepEqual(matcher.match("this goes 100x!"), [
    { phrase: "100x", tag: null },
  ]);
  assert.deepEqual(matcher.match("this goes 100x7"), []);
});

test("returns matches in keyword-list order", () => {
  const matcher = compileKeywordMatcher([kw("wl", "WL"), kw("mint live")]);
  assert.deepEqual(matcher.match("mint live — WL allocation"), [
    { phrase: "wl", tag: "WL" },
    { phrase: "mint live", tag: null },
  ]);
});

test("no keywords matches nothing", () => {
  const matcher = compileKeywordMatcher([]);
  assert.deepEqual(matcher.match("mint live"), []);
});

test("empty text matches nothing", () => {
  const matcher = compileKeywordMatcher([kw("mint")]);
  assert.deepEqual(matcher.match(""), []);
});

test("multi-word phrases match the literal sequence", () => {
  const matcher = compileKeywordMatcher([kw("whitelist open", "WL")]);
  assert.deepEqual(matcher.match("Whitelist   Open now".replace(/ {3}/, " ")), [
    { phrase: "whitelist open", tag: "WL" },
  ]);
});
```

Note the last test: it normalizes runs of whitespace in the *text* to a single space, documenting that a phrase matches after whitespace collapsing (implemented below).

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module './keywords.js'` (or equivalent resolution error).

- [ ] **Step 4: Implement the matcher**

Create `src/lib/keywords.ts`:

```ts
export type MatchedKeyword = { phrase: string; tag: string | null };
export type KeywordLike = { phrase: string; tag: string | null };

export type KeywordMatcher = {
  match: (text: string) => MatchedKeyword[];
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Case-insensitive, word-boundary-safe literal matching. Runs of whitespace
 * in both the phrase and the text are collapsed first so "mint  live" in a
 * tweet still matches the phrase "mint live".
 */
export function compileKeywordMatcher(keywords: KeywordLike[]): KeywordMatcher {
  const rules = keywords.map((keyword) => {
    const phrase = keyword.phrase.trim().toLowerCase();
    const spaced = phrase.split(/\s+/).map(escapeRegExp).join("\\s+");
    // Unicode lookarounds (not \b, which is ASCII-only) so short tokens like
    // "gtd" don't match inside longer words while punctuation still counts
    // as a boundary.
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${spaced}(?![\\p{L}\\p{N}])`, "iu");
    return { phrase, tag: keyword.tag, pattern };
  });

  return {
    match(text: string): MatchedKeyword[] {
      const haystack = text.toLowerCase().replace(/\s+/g, " ");
      const seen = new Set<string>();
      const matched: MatchedKeyword[] = [];
      for (const rule of rules) {
        if (rule.phrase === "" || seen.has(rule.phrase)) continue;
        if (rule.pattern.test(haystack)) {
          seen.add(rule.phrase);
          matched.push({ phrase: rule.phrase, tag: rule.tag });
        }
      }
      return matched;
    },
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all 9 tests.

- [ ] **Step 6: Commit**

```bash
git add src/lib/keywords.ts src/lib/keywords.test.ts package.json
git commit -m "feat: keyword matcher with tests"
```

---

### Task 3: Keywords CRUD — HttpError relocation, service, routes, mount

**Files:**
- Create: `src/lib/http-error.ts`
- Create: `src/services/keywords.ts`
- Create: `src/routes/keywords.ts`
- Modify: `src/services/projects.ts:11-21` (HttpError class → re-export)
- Modify: `src/server.ts:5-10,38-43` (import + mount)

**Interfaces:**
- Consumes: prisma `keyword` model (Task 1).
- Produces:
  - `src/lib/http-error.ts`: `class HttpError extends Error { readonly status: number }`
  - `src/services/keywords.ts`: `type KeywordDTO = { id: string; phrase: string; tag: string | null; enabled: boolean; createdAt: string; updatedAt: string }`; `type KeywordInput = { phrase?: string; tag?: string | null; enabled?: boolean }`; `listKeywords(): Promise<KeywordDTO[]>`; `createKeyword(input): Promise<KeywordDTO>`; `updateKeyword(id: string, input): Promise<KeywordDTO>`; `deleteKeyword(id: string): Promise<{ deleted: boolean; id: string }>`
  - HTTP: `GET /keywords` → `{ keywords }`, `POST /keywords` → 201 `{ keyword }`, `PATCH /keywords/:id` → `{ keyword }`, `DELETE /keywords/:id` → `{ deleted, id }` (webui path `/api/keywords`).

- [ ] **Step 1: Relocate HttpError**

Create `src/lib/http-error.ts`:

```ts
export class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "HttpError";
  }
}
```

In `src/services/projects.ts`, delete the local `HttpError` class (lines 11–21) and replace with:

```ts
import { HttpError } from "../lib/http-error.js";

export { HttpError };
```

(Keep the existing `import type { Prisma } …` line; the re-export preserves `import { HttpError } from "../services/projects.js"` in `src/routes/projects.ts` and `src/routes/webhooks.ts`.)

- [ ] **Step 2: Write the service**

Create `src/services/keywords.ts`:

```ts
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
    if (pgCode(error) === "23505") {
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
```

- [ ] **Step 3: Write the routes**

Create `src/routes/keywords.ts`:

```ts
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
```

- [ ] **Step 4: Mount the router**

In `src/server.ts`, add to the route imports (after the `growthRouter` import):

```ts
import { keywordsRouter } from "./routes/keywords.js";
```

and after `app.use("/growth", growthRouter);`:

```ts
app.use("/keywords", keywordsRouter);
```

- [ ] **Step 5: Type-check**

Run: `npm run build:api`
Expected: compiles clean.

- [ ] **Step 6: Verify CRUD behavior with curl**

Run `npm run dev` in one terminal, then:

```bash
curl -s -X POST localhost:5500/keywords -H 'content-type: application/json' -d '{"phrase":"Mint Live","tag":"Mint"}'
```
Expected: `201` with `{"keyword":{"id":"1","phrase":"mint live","tag":"Mint","enabled":true,…}}` — note lowercased phrase and **string** id.

```bash
curl -s -X POST localhost:5500/keywords -H 'content-type: application/json' -d '{"phrase":"mint live"}'
```
Expected: `{"error":"Keyword \"mint live\" already exists"}` with status 409.

```bash
curl -s -X POST localhost:5500/keywords -H 'content-type: application/json' -d '{"phrase":"   "}'
```
Expected: 400 `phrase is required`.

```bash
curl -s -X PATCH localhost:5500/keywords/1 -H 'content-type: application/json' -d '{"phrase":"nope"}'
```
Expected: 400 `phrase is immutable; delete and re-create the keyword`.

```bash
curl -s -X PATCH localhost:5500/keywords/1 -H 'content-type: application/json' -d '{"tag":"Mint live","enabled":false}'
curl -s localhost:5500/keywords
curl -s -X POST localhost:5500/keywords -H 'content-type: application/json' -d '{"phrase":"gtd"}'
curl -s -X DELETE localhost:5500/keywords/2
```
Expected: PATCH returns `"enabled":false`; GET lists rows; DELETE returns `{"deleted":true,"id":"2"}`.

- [ ] **Step 7: Commit**

```bash
git add src/lib/http-error.ts src/services/keywords.ts src/routes/keywords.ts src/services/projects.ts src/server.ts
git commit -m "feat: keywords CRUD API"
```

---

### Task 4: Telegram alert service

**Files:**
- Create: `src/services/telegram.ts`
- Delete: `src/tgBot/bot.ts` (stub)
- Modify: `.env.example` (document env vars)

**Interfaces:**
- Consumes: grammy `Bot` (installed).
- Produces (used by Task 5): `sendTelegramAlert(alert: { label: string; username: string; text: string; url: string }): Promise<boolean>` — resolves `true` if sent, `false` if unconfigured/failed; never rejects.

- [ ] **Step 1: Write the service**

Create `src/services/telegram.ts`:

```ts
import { Bot } from "grammy";

export type TelegramAlert = {
  label: string;
  username: string;
  text: string;
  url: string;
};

let bot: Bot | null = null;
let warnedMissingConfiguration = false;

function getBot(): Bot | null {
  if (bot) return bot;
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    if (!warnedMissingConfiguration) {
      console.warn(
        "[telegram] TELEGRAM_BOT_TOKEN is not set; telegram alerts are disabled",
      );
      warnedMissingConfiguration = true;
    }
    return null;
  }
  bot = new Bot(token);
  return bot;
}

/** Fire-and-forget alert sender; failures are logged, never thrown. */
export async function sendTelegramAlert(alert: TelegramAlert): Promise<boolean> {
  const activeBot = getBot();
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!activeBot || !chatId) return false;

  const text = `🚨 ${alert.label} — @${alert.username}\n\n${alert.text.slice(0, 300)}\n\n${alert.url}`;
  try {
    await activeBot.api.sendMessage(chatId, text);
    return true;
  } catch (error) {
    console.error("[telegram] delivery failed:", error);
    return false;
  }
}
```

- [ ] **Step 2: Remove the stub**

Run: `git rm src/tgBot/bot.ts` (removes the file and the now-empty `src/tgBot/` directory from git).

- [ ] **Step 3: Document the env vars**

Append to `.env.example`:

```
# Optional: Telegram alerts for keyword matches
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
```

- [ ] **Step 4: Type-check**

Run: `npm run build:api`
Expected: compiles clean.

- [ ] **Step 5: (Optional, if a real bot token exists) smoke-send**

```bash
TELEGRAM_BOT_TOKEN=<token> TELEGRAM_CHAT_ID=<chat> npx tsx -e 'import("./src/services/telegram.js").then(async (m) => console.log(await m.sendTelegramAlert({ label: "smoke", username: "test", text: "hello from x-feed", url: "https://example.com" })));'
```
Expected: `true` and a message in the chat. If no token, skip — the unconfigured path is exercised by Task 12.

- [ ] **Step 6: Commit**

```bash
git add src/services/telegram.ts .env.example
git commit -m "feat: telegram alert service"
```

---

### Task 5: Pipeline — detect at ingest, persist, gate + tag push, dispatch Telegram

**Files:**
- Modify: `src/feed/feed.ts:1-14` (imports), `:56-124` (`persistAndEmit`), `:126-171` (`runCycle` keyword load)

**Interfaces:**
- Consumes: `compileKeywordMatcher` (Task 2), `sendTelegramAlert` (Task 4), `sendTweetPushNotification` (existing), prisma match columns (Task 1).
- Produces: `feed:new` socket event items now carry `matchedKeywords: { phrase: string; tag: string | null }[] | null`; push fires only for matches with title `🚨 <tags> · <project name>`.

- [ ] **Step 1: Update imports**

At the top of `src/feed/feed.ts`, add:

```ts
import { Prisma } from "../generated/prisma/client.js";
import {
  compileKeywordMatcher,
  type KeywordMatcher,
  type MatchedKeyword,
} from "../lib/keywords.js";
import { sendTelegramAlert } from "../services/telegram.js";
```

- [ ] **Step 2: Thread the matcher through `persistAndEmit`**

Change the signature to:

```ts
async function persistAndEmit(
  io: FeedSocket,
  project: {
    userId: string;
    name: string;
    username: string;
    chain: string | null;
    tokenAddress: string | null;
    profileImageUrl: string | null;
  },
  statuses: APITwitterStatus[],
  matcher: KeywordMatcher,
) {
```

Replace the body of the `for (const status of statuses)` loop (create/update/emit/push section) with:

```ts
  const created = [];
  for (const status of statuses) {
    const data = toFeedPayload(status, project.userId);
    // Defensive per spec §11: classification must never fail ingestion.
    let matched: MatchedKeyword[] = [];
    try {
      matched = matcher.match(data.text);
    } catch (error) {
      console.error("[feed] keyword match failed:", error);
    }
    // Both columns are written on create AND update so a tweet edit that
    // removes the keyword clears stale matches (matchedCount back to 0).
    const matchData = {
      matchedKeywords:
        matched.length > 0
          ? (matched as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull,
      matchedCount: matched.length,
    };
    const existing = await prisma.feedItem.findUnique({
      where: { id: data.id },
      select: { id: true },
    });
    const item = existing
      ? await prisma.feedItem.update({
          where: { id: data.id },
          data: {
            text: data.text,
            likes: data.likes,
            reposts: data.reposts,
            replies: data.replies,
            payload: data.payload,
            ...matchData,
          },
        })
      : await prisma.feedItem.create({ data: { ...data, ...matchData } });

    // A push is only for a newly detected post. Existing items are refreshed
    // for engagement counts on later cycles and must not notify again.
    if (existing) continue;

    created.push(item);
    const feedEvent = {
      id: item.id,
      projectId: item.projectId,
      username: item.username,
      text: item.text,
      tweetUrl: item.tweetUrl,
      postedAt: item.postedAt.toISOString(),
      likes: item.likes,
      reposts: item.reposts,
      replies: item.replies,
      payload: item.payload,
      detectedAt: item.detectedAt.toISOString(),
      matchedKeywords: matched.length > 0 ? matched : null,
      project: {
        userId: project.userId,
        name: project.name,
        username: project.username,
        chain: project.chain,
        tokenAddress: project.tokenAddress,
        profileImageUrl: project.profileImageUrl,
      },
    };
    io.emit("feed:new", feedEvent);

    // Keyword-gated notifications: non-matching tweets stay silent in the
    // feed; matches push with a tagged title and ping Telegram.
    if (matched.length > 0) {
      const label = matched.map((m) => m.tag ?? m.phrase).join(", ");
      void sendTweetPushNotification({
        id: item.id,
        title: `🚨 ${label} · ${project.name}`,
        body: item.text.slice(0, 240),
        icon: project.profileImageUrl,
        url: item.tweetUrl,
      });
      void sendTelegramAlert({
        label,
        username: item.username,
        text: item.text,
        url: item.tweetUrl,
      });
    }
  }
  return created;
```

- [ ] **Step 3: Load keywords once per cycle in `runCycle`**

In `runCycle`, immediately after the `const projects = await prisma.project.findMany();` block (before the baseline-snapshot block), add:

```ts
  // One matcher per cycle: fresh keywords without a DB read per tweet.
  const keywords = await prisma.keyword.findMany({ where: { enabled: true } });
  const matcher = compileKeywordMatcher(keywords);
```

And change the `persistAndEmit` call site (inside the `if (hadNewTweets)` block) to pass it:

```ts
            await persistAndEmit(io, project, page.statuses, matcher);
```

- [ ] **Step 4: Type-check**

Run: `npm run build:api`
Expected: compiles clean. (`npm test` still passes — matcher untouched.)

- [ ] **Step 5: Commit**

```bash
git add src/feed/feed.ts
git commit -m "feat: keyword detection at feed ingest, gated push + telegram"
```

---

### Task 6: Feed API — expose `matchedKeywords`, add `?matched=1` filter

**Files:**
- Modify: `src/routes/feed.ts:6-48`

**Interfaces:**
- Consumes: `matchedCount` column (Task 1).
- Produces: every `/feed` item gains `matchedKeywords: { phrase; tag }[] | null`; `GET /feed?matched=1` returns only `matchedCount > 0` rows (used by Task 9's alpha view via `fetchFeed({ matched: true })`).

- [ ] **Step 1: Add the filter + field**

In `src/routes/feed.ts`, after the `limit` clamp, add:

```ts
    const matchedOnly = ["1", "true"].includes(String(req.query.matched ?? ""));
```

Change the query to:

```ts
    const items = await prisma.feedItem.findMany({
      take: limit,
      orderBy: { detectedAt: "desc" },
      include: { project: true },
      ...(matchedOnly ? { where: { matchedCount: { gt: 0 } } } : {}),
    });
```

And add to the response mapper (after `detectedAt`):

```ts
        matchedKeywords: item.matchedKeywords ?? null,
```

- [ ] **Step 2: Type-check**

Run: `npm run build:api`
Expected: compiles clean.

- [ ] **Step 3: Verify with curl**

With `npm run dev` running:

```bash
curl -s 'localhost:5500/feed?limit=1' | head -c 400
```
Expected: item JSON includes `"matchedKeywords":null` (pre-backfill rows are DB-NULL and excluded below).

```bash
curl -s 'localhost:5500/feed?matched=1'
```
Expected: `{"items":[]}` until ingest/backfill classifies rows (unclassified rows must NOT appear — `matchedCount` defaults to 0). Real-data verification happens after Task 11.

- [ ] **Step 4: Commit**

```bash
git add src/routes/feed.ts
git commit -m "feat: feed API exposes matched keywords + filter"
```

---

### Task 7: Webui — types + API client

**Files:**
- Modify: `webui/lib/types.ts` (after `WebhookInfo`, and `FeedItem`)
- Modify: `webui/lib/api.ts:1-9` (type imports), `:65-69` (`fetchFeed`), append keyword fetchers

**Interfaces:**
- Consumes: HTTP API from Tasks 3, 6.
- Produces (used by Tasks 8, 9, 10):
  - types: `MatchedKeyword`, `Keyword`, `KeywordInput`; `FeedItem.matchedKeywords: MatchedKeyword[] | null`
  - api: `fetchFeed(options?: { limit?: number; matched?: boolean })` (default still `{ limit: 80 }`); `fetchKeywords(): Promise<{ keywords: Keyword[] }>`; `createKeyword(input: KeywordInput): Promise<{ keyword: Keyword }>`; `updateKeyword(id: string, input: KeywordInput): Promise<{ keyword: Keyword }>`; `deleteKeyword(id: string): Promise<{ deleted: boolean; id: string }>`

- [ ] **Step 1: Add types**

In `webui/lib/types.ts`, after the `WebhookInfo` type, add:

```ts
export type MatchedKeyword = {
  phrase: string;
  tag: string | null;
};

export type Keyword = {
  id: string;
  phrase: string;
  tag: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type KeywordInput = {
  phrase?: string;
  tag?: string | null;
  enabled?: boolean;
};
```

In the `FeedItem` type, add after `detectedAt: string;`:

```ts
  matchedKeywords: MatchedKeyword[] | null;
```

- [ ] **Step 2: Extend `fetchFeed` and add keyword client functions**

In `webui/lib/api.ts`, extend the type import list with `Keyword, KeywordInput` and replace `fetchFeed` with:

```ts
export async function fetchFeed(
  options: { limit?: number; matched?: boolean } = {},
) {
  const limit = options.limit ?? 80;
  const params = new URLSearchParams({ limit: String(limit) });
  if (options.matched) params.set("matched", "1");
  const data = await request<{ items?: FeedItem[] }>(`/feed?${params}`);
  return { items: Array.isArray(data.items) ? data.items : [] };
}
```

Append at the end of the file:

```ts
export async function fetchKeywords() {
  const data = await request<{ keywords?: Keyword[] }>("/keywords");
  return { keywords: Array.isArray(data.keywords) ? data.keywords : [] };
}

export function createKeyword(input: KeywordInput) {
  return request<{ keyword: Keyword }>("/keywords", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateKeyword(id: string, input: KeywordInput) {
  return request<{ keyword: Keyword }>(`/keywords/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function deleteKeyword(id: string) {
  return request<{ deleted: boolean; id: string }>(`/keywords/${id}`, {
    method: "DELETE",
  });
}
```

- [ ] **Step 3: Type-check**

Run: `cd webui && npx tsc --noEmit`
Expected: clean (the new nullable field is additive).

- [ ] **Step 4: Commit**

```bash
git add webui/lib/types.ts webui/lib/api.ts
git commit -m "feat(webui): keyword api client + types"
```

---

### Task 8: Webui — Keywords management view

**Files:**
- Create: `webui/components/keywords-view.tsx`
- Create: `webui/app/keywords/page.tsx`
- Modify: `webui/components/app-sidebar.tsx:6,20-26`

**Interfaces:**
- Consumes: Task 7 api/types.
- Produces: `/keywords` page — table of phrases with add form, tag edit, enabled toggle, delete.

- [ ] **Step 1: Create the view component**

Create `webui/components/keywords-view.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { Plus, Tags } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import {
  createKeyword,
  deleteKeyword,
  fetchKeywords,
  updateKeyword,
} from "@/lib/api";
import type { Keyword } from "@/lib/types";

export function KeywordsView() {
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Keyword | null>(null);
  const [deleting, setDeleting] = useState<Keyword | null>(null);

  useEffect(() => {
    fetchKeywords()
      .then((data) => setKeywords(data.keywords ?? []))
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to load keywords");
      })
      .finally(() => setLoading(false));
  }, []);

  async function toggleEnabled(keyword: Keyword, enabled: boolean) {
    const { keyword: next } = await updateKeyword(keyword.id, { enabled });
    setKeywords((current) =>
      (current ?? []).map((row) => (row.id === next.id ? next : row)),
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex flex-col gap-4 border-b px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold">Keywords</h1>
          <p className="text-sm text-muted-foreground">
            Posts matching these phrases get badged, highlighted, and alerted
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus data-icon="inline-start" />
          Add keyword
        </Button>
      </div>

      {loading ? (
        <div className="space-y-3 p-6">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : error ? (
        <p className="p-6 text-sm text-destructive">{error}</p>
      ) : keywords.length === 0 ? (
        <Empty className="flex-1 border-0">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Tags />
            </EmptyMedia>
            <EmptyTitle>No keywords</EmptyTitle>
            <EmptyDescription>
              Add phrases like “mint live”, “whitelist”, or “gtd” to detect
              launch announcements in the feed.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button onClick={() => setCreateOpen(true)}>Add keyword</Button>
          </EmptyContent>
        </Empty>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Phrase</TableHead>
                <TableHead>Tag</TableHead>
                <TableHead>Enabled</TableHead>
                <TableHead className="w-32" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {keywords.map((keyword) => (
                <TableRow key={keyword.id}>
                  <TableCell className="font-medium">{keyword.phrase}</TableCell>
                  <TableCell>
                    {keyword.tag ? (
                      <Badge variant="secondary" className="font-normal">
                        {keyword.tag}
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={keyword.enabled}
                        onCheckedChange={(checked) => {
                          void toggleEnabled(keyword, checked).catch(
                            (err: unknown) => {
                              toast.error(
                                err instanceof Error
                                  ? err.message
                                  : "Update failed",
                              );
                            },
                          );
                        }}
                      />
                      <Badge
                        variant={keyword.enabled ? "secondary" : "outline"}
                      >
                        {keyword.enabled ? "On" : "Off"}
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setEditing(keyword)}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => setDeleting(keyword)}
                      >
                        Delete
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <KeywordDialog
        open={createOpen}
        title="Add keyword"
        description="Phrases match case-insensitively on whole words. Matches alert from the next poll cycle on."
        submitLabel="Add"
        onOpenChange={setCreateOpen}
        onSubmit={async (input) => {
          const { keyword } = await createKeyword(input);
          setKeywords((current) => [keyword, ...(current ?? [])]);
          toast.success(`Added "${keyword.phrase}"`);
        }}
      />

      <KeywordDialog
        key={editing?.id ?? "edit"}
        open={Boolean(editing)}
        title="Edit keyword"
        description="The phrase is immutable — delete and re-create it to change what it matches."
        submitLabel="Save"
        tag={editing?.tag ?? ""}
        enabled={editing?.enabled ?? true}
        phraseReadOnly
        phrase={editing?.phrase ?? ""}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        onSubmit={async (input) => {
          if (!editing) return;
          const { keyword } = await updateKeyword(editing.id, input);
          setKeywords((current) =>
            (current ?? []).map((row) => (row.id === keyword.id ? keyword : row)),
          );
          toast.success("Keyword updated");
        }}
      />

      <AlertDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete keyword?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting
                ? `Existing matches on past posts are kept; future posts are no longer matched.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (!deleting) return;
                void deleteKeyword(deleting.id)
                  .then(() => {
                    setKeywords((current) =>
                      (current ?? []).filter((row) => row.id !== deleting.id),
                    );
                    toast.success(`Removed "${deleting.phrase}"`);
                    setDeleting(null);
                  })
                  .catch((err: unknown) => {
                    toast.error(
                      err instanceof Error ? err.message : "Delete failed",
                    );
                  });
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function KeywordDialog({
  open,
  title,
  description,
  submitLabel,
  phrase = "",
  phraseReadOnly = false,
  tag = "",
  enabled = true,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  title: string;
  description: string;
  submitLabel: string;
  phrase?: string;
  phraseReadOnly?: boolean;
  tag?: string;
  enabled?: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: {
    phrase?: string;
    tag?: string | null;
    enabled?: boolean;
  }) => Promise<void>;
}) {
  const [phraseValue, setPhraseValue] = useState(phrase);
  const [tagValue, setTagValue] = useState(tag);
  const [active, setActive] = useState(enabled);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setPhraseValue(phrase);
    setTagValue(tag);
    setActive(enabled);
    setError(null);
  }, [open, phrase, tag, enabled]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            setPending(true);
            setError(null);
            const input: {
              phrase?: string;
              tag?: string | null;
              enabled?: boolean;
            } = { enabled: active };
            if (!phraseReadOnly) input.phrase = phraseValue.trim();
            input.tag = tagValue.trim() === "" ? null : tagValue.trim();
            void onSubmit(input)
              .then(() => onOpenChange(false))
              .catch((err: unknown) => {
                setError(err instanceof Error ? err.message : "Save failed");
              })
              .finally(() => setPending(false));
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor="keyword-phrase">Phrase</Label>
            <Input
              id="keyword-phrase"
              placeholder="mint live"
              value={phraseValue}
              onChange={(event) => setPhraseValue(event.target.value)}
              disabled={pending || phraseReadOnly}
              required={!phraseReadOnly}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="keyword-tag">Tag (badge label)</Label>
            <Input
              id="keyword-tag"
              placeholder="Mint"
              value={tagValue}
              onChange={(event) => setTagValue(event.target.value)}
              disabled={pending}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={active} onCheckedChange={setActive} />
            Enabled
          </label>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : submitLabel}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Create the page**

Create `webui/app/keywords/page.tsx`:

```tsx
import { KeywordsView } from "@/components/keywords-view";

export default function KeywordsPage() {
  return <KeywordsView />;
}
```

- [ ] **Step 3: Add the sidebar entry**

In `webui/components/app-sidebar.tsx`, update the lucide import:

```ts
import {
  Rss,
  FolderKanban,
  KeyRound,
  Webhook,
  TrendingUp,
  Tags,
} from "lucide-react";
```

and add to `nav` after the Projects entry:

```ts
  { title: "Keywords", href: "/keywords", icon: Tags },
```

- [ ] **Step 4: Verify**

Run: `cd webui && npx tsc --noEmit && npm run lint`
Expected: clean. With both dev servers running, open `/keywords`, add `mint live` + tag `Mint`, toggle it off/on, edit the tag, delete it.

- [ ] **Step 5: Commit**

```bash
git add webui/components/keywords-view.tsx webui/app/keywords webui/components/app-sidebar.tsx
git commit -m "feat(webui): keywords management view"
```

---

### Task 9: Webui — Alpha view

**Files:**
- Create: `webui/components/alpha-view.tsx`
- Create: `webui/app/alpha/page.tsx`
- Modify: `webui/components/app-sidebar.tsx:6,20-27` (import `Zap`, nav entry)

**Interfaces:**
- Consumes: `fetchFeed({ matched: true })` + `FeedItem.matchedKeywords` (Task 7), `FeedItemCard` (existing), socket `feed:new` payload (Task 5).
- Produces: `/alpha` page — live list of only keyword-matching posts.

- [ ] **Step 1: Create the view**

Create `webui/components/alpha-view.tsx` (modeled on `feed-view.tsx`, minus the notifications toggle, with a matched-only fetch and a socket filter):

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import { Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { FeedItemCard } from "@/components/feed-item-card";
import { SOCKET_URL, fetchFeed } from "@/lib/api";
import type { FeedItem } from "@/lib/types";

export function AlphaView() {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const seenRef = useRef<Set<string>>(new Set());
  const socketRef = useRef<ReturnType<typeof io> | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchFeed({ matched: true })
      .then((data) => {
        if (cancelled) return;
        const rows = data.items ?? [];
        rows.forEach((row) => seenRef.current.add(row.id));
        setItems((current) => {
          const fetched = new Set(rows.map((row) => row.id));
          const live = (current ?? []).filter((row) => !fetched.has(row.id));
          return [...live, ...rows];
        });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load feed");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const socket = io(SOCKET_URL, {
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30000,
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      setConnected(true);
      // After a reconnect, re-fetch to catch matched items missed offline.
      fetchFeed({ matched: true })
        .then((data) => {
          const rows = data.items ?? [];
          rows.forEach((row) => seenRef.current.add(row.id));
          setItems((current) => {
            const fetched = new Set(rows.map((row) => row.id));
            const live = (current ?? []).filter((row) => !fetched.has(row.id));
            return [...live, ...rows];
          });
        })
        .catch(() => {});
    });
    socket.on("disconnect", () => setConnected(false));
    socket.on("feed:new", (item: FeedItem) => {
      // Non-matching items must never enter the alpha list.
      if (!item.matchedKeywords || item.matchedKeywords.length === 0) return;
      if (seenRef.current.has(item.id)) return;
      seenRef.current.add(item.id);

      setItems((current) => [item, ...(current ?? [])]);
      setNewIds((current) => {
        const next = new Set(current);
        next.add(item.id);
        return next;
      });
      window.setTimeout(() => {
        setNewIds((current) => {
          const next = new Set(current);
          next.delete(item.id);
          return next;
        });
      }, 4000);
    });
    return () => {
      socket.disconnect();
    };
  }, []);

  // Android Chrome freezes background tabs — reconnect when the user returns.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        const socket = socketRef.current;
        if (socket && !socket.connected) {
          socket.connect();
        }
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  return (
    <div className="mx-auto w-full min-w-0 max-w-2xl overflow-x-clip">
      <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-background/80 px-4 py-3 backdrop-blur">
        <div>
          <h1 className="text-lg font-semibold">Alpha</h1>
          <p className="text-sm text-muted-foreground">
            Posts matching your keywords
          </p>
        </div>
        <Badge variant={connected ? "secondary" : "outline"}>
          <span
            className={
              connected
                ? "mr-1.5 size-1.5 rounded-full bg-emerald-500"
                : "mr-1.5 size-1.5 rounded-full bg-muted-foreground"
            }
          />
          {connected ? "Live" : "Offline"}
        </Badge>
      </div>

      {loading ? (
        <div className="space-y-4 p-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="flex gap-3">
              <Skeleton className="size-10 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-16 w-full" />
              </div>
            </div>
          ))}
        </div>
      ) : error ? (
        <p className="p-6 text-sm text-destructive">{error}</p>
      ) : items.length === 0 ? (
        <Empty className="border-0">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Zap />
            </EmptyMedia>
            <EmptyTitle>No matches yet</EmptyTitle>
            <EmptyDescription>
              Add keywords and matching posts will collect here.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            Manage phrases on the Keywords page; matches appear here live.
          </EmptyContent>
        </Empty>
      ) : (
        <div>
          {items.map((item) => (
            <FeedItemCard
              key={item.id}
              item={item}
              isNew={newIds.has(item.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create the page**

Create `webui/app/alpha/page.tsx`:

```tsx
import { AlphaView } from "@/components/alpha-view";

export default function AlphaPage() {
  return <AlphaView />;
}
```

- [ ] **Step 3: Add the sidebar entry**

In `webui/components/app-sidebar.tsx`, add `Zap` to the lucide import and insert as the second nav entry (right after Feed — Alpha is a feed variant):

```ts
  { title: "Feed", href: "/", icon: Rss },
  { title: "Alpha", href: "/alpha", icon: Zap },
```

- [ ] **Step 4: Verify**

Run: `cd webui && npx tsc --noEmit && npm run lint`
Expected: clean. Open `/alpha` — empty state until backfill (Task 11) or a live match.

- [ ] **Step 5: Commit**

```bash
git add webui/components/alpha-view.tsx webui/app/alpha webui/components/app-sidebar.tsx
git commit -m "feat(webui): alpha view"
```

---

### Task 10: Webui — feed card badges + text highlight

**Files:**
- Modify: `webui/components/feed-item-card.tsx:38-72` (`LinkifiedText` + helpers), `:320-329` (badge row), `:342-344` (text render)

**Interfaces:**
- Consumes: `item.matchedKeywords` (Task 7).
- Produces: amber keyword badges after the Repost/Quote kind badges; matched phrases highlighted in the tweet text.

- [ ] **Step 1: Add a highlight pass to the text renderer**

In `webui/components/feed-item-card.tsx`, add a helper after the `TRAILING_URL_PUNCTUATION` constant:

```tsx
function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Highlight configured keyword phrases inside a plain (non-URL) segment. */
function HighlightMatches({
  text,
  phrases,
}: {
  text: string;
  phrases: string[];
}) {
  if (text === "" || phrases.length === 0) return <>{text}</>;
  // Longest-first so "mint live" wins over "mint" at the same position.
  const ordered = [...phrases].sort((a, b) => b.length - a.length);
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}])(${ordered.map(escapeRegExp).join("|")})(?![\\p{L}\\p{N}])`,
    "giu",
  );
  const parts = text.split(pattern);
  const lowered = phrases.map((phrase) => phrase.toLowerCase());
  return (
    <>
      {parts.map((part, index) =>
        lowered.includes(part.toLowerCase()) ? (
          <mark
            key={index}
            className="rounded-sm bg-amber-500/20 text-inherit dark:bg-amber-400/25"
          >
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </>
  );
}
```

Then extend `LinkifiedText` (same file) to take highlights and wrap plain segments:

```tsx
/** Render HTTP(S) URLs from tweet text as external links, highlighting
 * configured keyword phrases in the plain segments. */
function LinkifiedText({
  text,
  highlights = [],
}: {
  text: string;
  highlights?: string[];
}) {
  const parts: ReactNode[] = [];
  let cursor = 0;

  for (const match of text.matchAll(URL_PATTERN)) {
    const rawUrl = match[0];
    const start = match.index ?? cursor;
    const url = rawUrl.replace(TRAILING_URL_PUNCTUATION, "");
    const trailing = rawUrl.slice(url.length);

    if (start > cursor)
      parts.push(<HighlightMatches key={`t-${start}`} text={text.slice(cursor, start)} phrases={highlights} />);
    if (url) {
      parts.push(
        <a
          key={`${start}-${url}`}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="break-all text-blue-500 hover:underline hover:underline-offset-2 hover:text-blue-400 dark:text-blue-400 dark:hover:text-blue-300"
        >
          {url}
        </a>,
      );
    }
    if (trailing) parts.push(trailing);
    cursor = start + rawUrl.length;
  }

  if (cursor < text.length)
    parts.push(<HighlightMatches key={`t-end`} text={text.slice(cursor)} phrases={highlights} />);
  return <>{parts}</>;
}
```

- [ ] **Step 2: Render keyword badges after the kind badges**

In `FeedItemCard`, after the `{kinds.map((kind) => (…))}` block and before the chain badge, insert:

```tsx
            {(item.matchedKeywords ?? []).map((matched) => (
              <Badge
                key={matched.phrase}
                className="border-amber-500/40 bg-amber-500/15 font-normal text-amber-700 dark:text-amber-300"
              >
                {matched.tag ?? matched.phrase}
              </Badge>
            ))}
```

- [ ] **Step 3: Pass the phrases to the text renderer**

Change the tweet text paragraph to:

```tsx
          <p className="mt-1 wrap-break-word whitespace-pre-wrap text-sm leading-6">
            <LinkifiedText
              text={item.text}
              highlights={(item.matchedKeywords ?? []).map(
                (matched) => matched.phrase,
              )}
            />
          </p>
```

- [ ] **Step 4: Verify**

Run: `cd webui && npx tsc --noEmit && npm run lint`
Expected: clean (the file may carry local uncommitted edits — do not revert them; build on the working tree).

- [ ] **Step 5: Commit**

```bash
git add webui/components/feed-item-card.tsx
git commit -m "feat(webui): keyword badges + text highlight"
```

---

### Task 11: Backfill script

**Files:**
- Create: `scripts/backfill-keywords.ts`

**Interfaces:**
- Consumes: `compileKeywordMatcher` (Task 2), prisma match columns (Task 1).
- Produces: one-shot classification of all `feed_items` rows whose `matchedKeywords` is DB NULL (only pre-feature rows — ingest writes JSON null). Idempotent.

- [ ] **Step 1: Write the script**

Create `scripts/backfill-keywords.ts`:

```ts
import "dotenv/config";
import { Prisma } from "../src/generated/prisma/client.js";
import { prisma } from "../src/db/prisma.js";
import { compileKeywordMatcher } from "../src/lib/keywords.js";

const BATCH_SIZE = 500;

async function main() {
  const keywords = await prisma.keyword.findMany({ where: { enabled: true } });
  if (keywords.length === 0) {
    console.log("[backfill] no enabled keywords; nothing to classify");
    return;
  }
  const matcher = compileKeywordMatcher(keywords);

  // DB NULL = never classified (pre-feature rows). JSON null = already
  // classified empty, so re-running never rescans.
  let cursor: string | undefined;
  let scanned = 0;
  let matchedCount = 0;
  for (;;) {
    const rows = await prisma.feedItem.findMany({
      take: BATCH_SIZE,
      ...(cursor === undefined ? {} : { skip: 1, cursor: { id: cursor } }),
      where: { matchedKeywords: { equals: Prisma.DbNull } },
      orderBy: { id: "asc" },
      select: { id: true, text: true },
    });
    if (rows.length === 0) break;

    for (const row of rows) {
      const matched = matcher.match(row.text);
      await prisma.feedItem.update({
        where: { id: row.id },
        data: {
          matchedKeywords:
            matched.length > 0
              ? (matched as unknown as Prisma.InputJsonValue)
              : Prisma.JsonNull,
          matchedCount: matched.length,
        },
      });
      if (matched.length > 0) matchedCount++;
    }
    scanned += rows.length;
    cursor = rows[rows.length - 1].id;
    console.log(
      `[backfill] ${scanned} scanned, ${matchedCount} matched so far`,
    );
  }
  console.log(`[backfill] done: ${scanned} scanned, ${matchedCount} matched`);
}

main()
  .catch((error) => {
    console.error("[backfill] failed:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
```

- [ ] **Step 2: Run it**

Ensure at least one keyword exists (Task 3 curl or the Keywords page), then:

Run: `npx tsx scripts/backfill-keywords.ts`
Expected: progress logs ending `done: N scanned, M matched`. Re-run → `done: 0 scanned, 0 matched` (idempotent).

- [ ] **Step 3: Verify the API serves real matches**

```bash
curl -s 'localhost:5500/feed?matched=1' | head -c 600
```
Expected: items whose `matchedKeywords` arrays are non-empty (assuming M > 0).

- [ ] **Step 4: Commit**

```bash
git add scripts/backfill-keywords.ts
git commit -m "feat: backfill keyword matches"
```

---

### Task 12: End-to-end manual smoke

**Files:** none created — verification only.

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Full-stack smoke**

Run `npm run dev` and `cd webui && npm run dev`; open the webui:

1. **Keywords page**: add `mint live` (tag `Mint`), `whitelist`, `gtd`; toggle one off and on; edit a tag; delete a throwaway phrase. Duplicate phrase shows the 409 message as a toast.
2. **Feed page**: after backfill (Task 11), matching posts show amber badges (tag or phrase) and highlighted phrases in the text; non-matching posts unchanged.
3. **Alpha page**: only matched posts; matches arriving live over socket prepend with the highlight flash; a non-matching live post must NOT appear.
4. **Stale-match clearing**: pick a matched item whose author edited the keyword out of the tweet; after the poller refreshes it (engagement update path), its badge disappears and it leaves `/feed?matched=1`.
5. **Push + Telegram**: with VAPID configured, a *matching* new tweet pushes with title `🚨 <tag|phrase> · <project>`; a *non-matching* tweet pushes nothing (watch the server logs — no `[push]`/`[telegram]` activity). With `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` set, the matched tweet also lands in Telegram; with them unset, the server logs the one-time `[telegram]` warning and continues.
6. Run `npm test` one final time — all green.

- [ ] **Step 2: No commit needed** (verification only; any fix-ups get their own tasks/commits).
