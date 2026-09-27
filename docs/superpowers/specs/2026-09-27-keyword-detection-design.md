# Keyword Detection ("Alpha" Alerts) — Design

Date: 2026-09-27
Status: Approved in brainstorming; pending implementation plan

## Intent

The feed polls tracked crypto projects and currently treats every tweet the
same: it lands in the feed, fires a socket event, and sends a web push.
Launch announcements ("mint live", "whitelist open", "gtd") drown in that
noise. We want tweets containing operator-managed keywords to be detectable
at ingest and to drive four outcomes:

1. **Badge + highlight** in the feed card UI.
2. **Smarter push** — only keyword-matching tweets push, tagged with the match.
3. **"Alpha" view** — a page showing only matching posts.
4. **Telegram alert** for matches, via the already-installed grammy dep.

Approved decisions:

- Keyword list is **managed in the webui** (DB table + CRUD UI), not hardcoded.
- **Only matches push.** Non-matching tweets no longer send web push.
- External alert target is **Telegram** (no outbound generic webhook).
- Architecture is **persist at ingest** (approach A): match once when a tweet
  is created or updated, store the result on `FeedItem`, and let every
  consumer read what is stored.

## 1. Data model

One Prisma migration (`npm run db:migrate`) adds:

```prisma
model Keyword {
  id        BigInt   @id @default(autoincrement())
  phrase    String   @unique          // e.g. "mint live"; matched case-insensitively
  tag       String?                   // optional badge label, e.g. "Mint"; fallback = phrase
  enabled   Boolean  @default(true)
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz

  @@map("keywords")
}
```

`FeedItem` gains two columns:

- `matchedKeywords Json?` — array of matched `{ phrase, tag }` objects
  (shape in §8; `null` = not classified, pre-backfill rows). This is the
  display source of truth.
- `matchedCount Int @default(0)` — denormalized length of the array so the
  Alpha filter is a trivial, indexable `matchedCount > 0` query (Prisma has
  no jsonb-array-length filter).

Index: `@@index([matchedCount, detectedAt(sort: Desc)])` on `feed_items` to
serve the Alpha view.

## 2. Matcher — `src/lib/keywords.ts`

Pure module, no I/O:

- `compileKeywordMatcher(keywords: { phrase: string }[]): Matcher`
- `Matcher.match(text: string): string[]` — matched phrases, deduped, in the
  order they appear in the keyword list.

Semantics:

- Case-insensitive.
- Word-boundary safe via unicode lookarounds:
  `(?<![\p{L}\p{N}])phrase(?![\p{L}\p{N}])` with the `u` flag. `"gtd"` does
  not match inside `"xgtdx"`; `"mint"` still matches `"Mint!"`.
- Phrases are regex-escaped; operators in a phrase are literal.
- Multi-word phrases match the literal sequence.

Unit tests with `node:test` executed through tsx (the repo has no test
runner yet — this adds the `test` script with zero new dependencies):
boundaries, case-insensitivity, multi-word, punctuation adjacency, dedupe,
empty list, disabled keywords excluded by the caller.

## 3. Pipeline — `src/feed/feed.ts`

In `runCycle`:

- Load enabled keywords once per cycle, compile the matcher. No keywords →
  matcher that returns `[]` (feature effectively off).

In `persistAndEmit`:

- On **create and on update** of a `FeedItem`, compute the match from
  `item.text` and persist `matchedKeywords` + `matchedCount` (authors edit
  tweets; updates must re-classify).
- **Newly created items only** (unchanged rule: updates must not re-notify):
  - Include `matchedKeywords` in the `feed:new` socket event payload.
  - If matches exist:
    - Web push with tagged title: `🚨 <tag|phrase> · <project name>`
      (first match; multiple tags joined with `,`).
    - `void sendTelegramAlert(...)` (fire-and-forget).
  - If no matches: **no push** (behavior change per approved decision).

## 4. Keywords API — `src/routes/keywords.ts` + `src/services/keywords.ts`

Mounted in `src/server.ts` alongside existing routers (server paths below;
the webui reaches them through its existing `/api` proxy and `request()`
helper; same absence of route auth as the rest of the API):

- `GET /keywords` — list all (including disabled), newest first.
- `POST /keywords` — `{ phrase, tag?, enabled? }`; 409 on duplicate phrase.
- `PATCH /keywords/:id` — `{ tag?, enabled? }` (phrase immutable; rename =
  delete + create, keeps history honest).
- `DELETE /keywords/:id`.

Validation: phrase trimmed, non-empty, ≤ 100 chars; tag ≤ 30 chars.

## 5. Webui — keywords management

- `app/keywords/page.tsx` + `components/keywords-view.tsx`: table of
  phrase / tag / enabled switch / delete, plus an add form. Follows the
  structure of `auth-tokens-view.tsx` / `projects-view.tsx`.
- Sidebar entry **"Keywords"** (lucide `Tags` icon) in `app-sidebar.tsx`.
- API client functions in `webui/lib/api.ts` next to the existing ones.

## 6. Webui — feed card badges + highlight (`feed-item-card.tsx`)

- `matchedKeywords` render as amber badges directly after the existing
  Repost/Quote kind badges; label = `tag ?? phrase` (the API/service maps
  phrases to tags for display — the webui receives `{ phrase, tag }` pairs
  in `matchedKeywords` so no extra lookup is needed; see §8 data shape).
- Text highlight: `LinkifiedText` keeps handling URLs; each plain segment is
  additionally wrapped by a highlight pass that case-insensitively marks the
  matched phrases with a subtle `<mark>` (amber tint, `text-inherit`).
- `FeedItem` type in `webui/lib/types.ts` gains
  `matchedKeywords?: { phrase: string; tag: string | null }[] | null`.

## 7. Webui — Alpha view

- `app/alpha/page.tsx` + `components/alpha-view.tsx`, sidebar entry
  **"Alpha"** (lucide `Zap` icon).
- Data: `GET /feed?matched=1` — same response shape as `GET /feed`, but
  filtered to `matchedCount > 0`. `GET /feed` (both variants) also gains
  `matchedKeywords` in its response items. Socket: listens to `feed:new` and
  prepends only items with non-empty matches, using the same
  dedupe-against-fetch pattern as `feed-view.tsx`.
- Reuses `FeedItemCard` unchanged.

## 8. Shared data shape

The stored `matchedKeywords` Json is an array of `{ phrase, tag }` objects
(tag may be null), so every consumer — socket event, `/api/feed` response,
Alpha view, badges — renders without re-reading the keywords table:

```json
[{ "phrase": "mint live", "tag": "Mint" }, { "phrase": "wl", "tag": null }]
```

## 9. Telegram — `src/services/telegram.ts`

- grammy `Bot` with `TELEGRAM_BOT_TOKEN`, sends to `TELEGRAM_CHAT_ID`.
- Gated like the push service: warn once if env is missing, then no-op.
- Message (plain text, URLs auto-linked by Telegram):
  `🚨 <tag|phrase> — @<username>\n<truncated text ≤ 300 chars>\n<tweet url>`
- Fire-and-forget with error logging; never throws into the feed cycle.
- The `src/tgBot/bot.ts` stub is deleted; its intent lives here.

## 10. Backfill — `scripts/backfill-keywords.ts`

One-time `npx tsx scripts/backfill-keywords.ts`:

- Iterates `feed_items` where `matchedKeywords IS NULL` in batches,
  classifies with the current enabled keywords, sets both columns.
- Idempotent (already-classified rows are skipped).

## 11. Error handling

- Matching failures never break ingestion: the matcher is pure and phrase
  input is regex-escaped, so failures are structurally impossible, but the
  match step is still defensive (try/catch, log, treat as no match).
- Telegram and push errors are logged, never thrown.
- Keywords API returns 4xx for validation/409; 500 shape matches existing
  routes.

## 12. Testing

- `src/lib/keywords.test.ts` — matcher unit tests (§2), run via the new
  `test` script (node:test through tsx).
- Manual smoke checklist after implementation: add keywords in UI → post
  matching text from a tracked account → badge + highlight in feed, Alpha
  view shows it, push arrives tagged, TG message arrives; non-matching post
  → no push; backfill populates history.

## Out of scope (follow-ups if ever needed)

- Regex / custom pattern keywords; severity tiers.
- Per-project keyword sets.
- Retroactive re-classification when keywords change (matches are frozen at
  ingest; backfill is one-time).
- Generic outbound webhooks (Discord/Slack-style).
