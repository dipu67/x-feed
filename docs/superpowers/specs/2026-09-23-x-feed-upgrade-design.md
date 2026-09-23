# x-feed Multi-User Upgrade & Feature Expansion — Design Spec

**Date:** 2026-09-23
**Status:** Draft (awaiting review)
**Author:** brainstorming + writing-plans pipeline

## Goal

Transform x-feed from a single-operator Twitter/X profile tracker into a multi-user, invite-only platform with per-user personalization, while upgrading the existing read-only subsystems and adding two-way interaction with X (post / like / reply / retweet).

## Target User

A small invite-only group. The existing `AdminUser` remains the operator. New `User` records are invitees who:

- See a personalized feed (filtered by their saved rules and follows)
- Receive web-push notifications only for projects they follow
- May interact with X (post, like, reply, retweet) using their own linked X account
- May bind their Telegram chat to receive alerts

## Architecture

**Layered evolution.** Existing schema and routes stay untouched. New tables sit alongside; existing routes gain new user-scoped variants only where unavoidable.

```
AdminUser (existing, operator)       User (new, invitee)
   |                                       |
   +-- /admin/* (untouched)                +-- per-user Filter, MuteKeyword
                                           +-- per-user PushSubscription (FK)
                                           +-- per-user UserFollow
                                           +-- per-user UserSession (cookie)
                                           +-- optional xauthtoken.user_id (post-as)
```

No data migration of `AdminUser` rows. The operator stays an operator. New schema is purely additive.

## Schema additions

All additions live alongside the existing `Project`, `FeedItem`, `PushSubscription`, and `xauthtoken` tables.

### `User`

```
id            String    @id (cuid2)
email         String    @unique
passwordHash  String    @map("password_hash")  // argon2id
displayName   String?   @map("display_name")
isActive      Boolean   @default(true)         @map("is_active")
createdAt     DateTime  @default(now())        @map("created_at")
updatedAt     DateTime  @updatedAt             @map("updated_at")
sessions      UserSession[]
filters       Filter[]
mutes         MuteKeyword[]
follows       UserFollow[]
pushSubs      PushSubscription[]
invitesMade   UserInvite[] @relation("InvitedBy")
inviteUsed    UserInvite?  @relation("InviteAcceptedBy")

@@map("users")
```

### `UserSession`

```
id         String   @id (cuid2)
userId     String   @map("user_id")
user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
tokenHash  String   @unique @map("token_hash")   // sha256 of cookie value
expiresAt  DateTime @map("expires_at")
createdAt  DateTime @default(now()) @map("created_at")
lastUsedAt DateTime @default(now()) @map("last_used_at")

@@index([userId])
@@index([expiresAt])
@@map("user_sessions")
```

### `UserInvite`

```
id              String   @id (cuid2)
tokenHash       String   @unique @map("token_hash")
invitedById     String   @map("invited_by_id")
invitedBy       User     @relation("InvitedBy", fields: [invitedById], references: [id])
acceptedById    String?  @unique @map("accepted_by_id")
acceptedBy      User?    @relation("InviteAcceptedBy", fields: [acceptedById], references: [id])
email           String?                              // pre-fill, optional
expiresAt       DateTime @map("expires_at")
createdAt       DateTime @default(now()) @map("created_at")
acceptedAt      DateTime? @map("accepted_at")

@@map("user_invites")
```

### `UserFollow`

```
id        String   @id @map("user_id")  // composite PK pattern not used; one row per (user, project)
userId    String   @map("user_id")
user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
projectId String   @map("project_id")
project   Project  @relation(fields: [projectId], references: [userId], onDelete: Cascade)
createdAt DateTime @default(now()) @map("created_at")

@@id([userId, projectId])
@@index([projectId])
@@map("user_follows")
```

> Note: `Project.userId` is a `String` so we treat it as the natural key. The follow row's primary key is the composite `(userId, projectId)`.

### `Filter`

```
id        String   @id (cuid2)
userId    String   @map("user_id")
user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
name      String                              // human label
kind      String                              // "project" | "keyword"
projectId String?  @map("project_id")
project   Project? @relation(fields: [projectId], references: [userId], onDelete: Cascade)
pattern   String?                             // regex source for keyword filters
action    String                              // "keep" | "hide"
isActive  Boolean  @default(true) @map("is_active")
createdAt DateTime @default(now()) @map("created_at")

@@index([userId])
@@index([userId, kind, isActive])
@@map("filters")
```

### `MuteKeyword`

```
id        String   @id (cuid2)
userId    String   @map("user_id")
user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
pattern   String                              // case-insensitive substring or /regex/
isRegex   Boolean  @default(false) @map("is_regex")
createdAt DateTime @default(now()) @map("created_at")

@@index([userId])
@@map("mute_keywords")
```

### `PushSubscription` — additive

Add a nullable `userId` column. New subscriptions are created with a logged-in session, so they get a `userId`. Existing rows (device-only) get backfilled to a sentinel "anon" user so the new code path has a single uniform lookup. The `userId` column is nullable for backwards compatibility during the rollout window.

```
userId  String?  @map("user_id")
user    User?    @relation(fields: [userId], references: [id], onDelete: SetNull)

@@index([userId])
```

### `xauthtoken` — additive

Add a nullable `userId` column. When a User wants to post/like/reply using their own X account, an admin links the `xauthtoken` row to that `userId`.

```
userId  String?  @map("user_id")

@@index([userId])
```

## Sub-project 1: User Accounts & Auth

### Routes (Express)

| Method | Path | Purpose |
|---|---|---|
| POST | `/auth/login` | Body `{ email, password }` → sets `xfeed_session` cookie, returns user |
| POST | `/auth/logout` | Revokes current session |
| POST | `/auth/accept-invite` | Body `{ token, displayName, password }` → creates User + session |
| GET  | `/auth/me` | Returns current user (401 if no session) |
| POST | `/admin/users/invites` | Admin-only — creates invite token |
| GET  | `/admin/users/invites` | Admin-only — list outstanding invites |
| DELETE | `/admin/users/invites/:id` | Admin-only — revoke invite |

### Mechanics

- **Password hashing:** argon2id with `memoryCost: 19MiB`, `timeCost: 2`, `parallelism: 1`.
- **Session token:** 32 random bytes, base64url. Cookie stores the raw value; DB stores `sha256(token)`.
- **Cookie:** `xfeed_session`, httpOnly, `Secure`, `SameSite=Lax`, `Path=/`, `Max-Age=30 days`. Refreshed on each request when within 7 days of expiry.
- **Invite:** admin POSTs to `/admin/users/invites`. Server returns one-time URL `https://host/auth/accept?token=…` (admin delivers out-of-band). Token valid 14 days. Single-use; binding to optional `email` is a hint, not a constraint at acceptance.
- **Middleware:** `requireUser(req, res, next)` attaches `req.user` or 401s. `requireAdmin(req, res, next)` checks `AdminUser` cookie or session flag.

### Acceptance criteria

- New `User` can accept invite, set password, log in, log out, return to authenticated state via cookie.
- Admin can create, list, revoke invites.
- Sessions expire after 30 days of inactivity.
- Reused email is rejected at invite-acceptance time with a clear message.

## Sub-project 2: Filters / Search / Mute

### Routes

| Method | Path | Purpose |
|---|---|---|
| GET    | `/feed?cursor=…&filter=mine` | Existing feed route gains `filter=mine` — applies viewer's filters + mutes |
| GET    | `/filters` | List viewer's filters |
| POST   | `/filters` | Create filter |
| PATCH  | `/filters/:id` | Update filter |
| DELETE | `/filters/:id` | Delete filter |
| GET    | `/mute-keywords` | List viewer's mutes |
| POST   | `/mute-keywords` | Add mute |
| DELETE | `/mute-keywords/:id` | Remove mute |

### Filter evaluation

A feed item is shown to a viewer iff:

1. Item's project is in viewer's `UserFollow` set OR viewer has no follows (back-compat: empty follows ⇒ all projects visible).
2. No active `Filter{action: "hide"}` matches:
   - `kind=project && projectId == item.projectId`, **or**
   - `kind=keyword && item.text matches pattern as regex`.
3. No `MuteKeyword` matches `item.text` (case-insensitive substring unless `isRegex=true`).

Filter evaluation runs in the route handler, not in the worker. The worker emits raw items; filtering is per-request.

### Acceptance criteria

- Viewer can create a "hide" filter for a specific project and confirm it disappears from their feed.
- Viewer can add a mute keyword and confirm it disappears.
- Filter evaluation is fast (< 5ms per request) — regex patterns are compiled once and cached on `MuteKeyword` insert/update.

## Sub-project 3: Posting / Reply / Like / Retweet

### `XWriteClient`

A new module `src/twitter/XWriteClient.ts` wraps `x-client-transaction-id` to perform write operations using a stored `xauthtoken`. Constructor takes a `XAuthToken` row; methods return `{ ok, error? }` discriminated unions.

```
class XWriteClient {
  constructor(token: XAuthToken)
  post(text: string, replyToTweetId?: string): Promise<WriteResult>
  like(tweetId: string): Promise<WriteResult>
  retweet(tweetId: string): Promise<WriteResult>
  reply(tweetId: string, text: string): Promise<WriteResult>
}
```

`WriteResult`:

```
type WriteResult =
  | { ok: true; tweetId: string; url: string }
  | { ok: false; error: 'rate_limited' | 'auth_invalid' | 'network' | 'unknown'; retryAfterMs?: number; message: string }
```

### Routes

| Method | Path | Purpose |
|---|---|---|
| POST | `/post` | Body `{ text, replyToTweetId? }` — uses viewer's linked xauthtoken |
| POST | `/post/:tweetId/like` | Like a tweet |
| POST | `/post/:tweetId/retweet` | Retweet |
| POST | `/post/:tweetId/reply` | Body `{ text }` |

### Linking an X account to a User

Admin-only: `POST /admin/users/:userId/link-x` with `{ xauthtokenId }`. Sets `xauthtoken.userId`. Unlink: `DELETE /admin/users/:userId/link-x/:xauthtokenId`. The viewer themselves cannot link — keeps secrets admin-only.

### Acceptance criteria

- Logged-in user with a linked X account can post, like, retweet, and reply from the webui.
- Rate-limit (429) surfaces `{ ok: false, error: 'rate_limited' }` and the UI shows a "try again in N seconds" hint.
- Invalid auth token surfaces `{ ok: false, error: 'auth_invalid' }` and the admin UI surfaces "X auth expired — re-link".
- All write calls go through a single circuit breaker per X account (see Sub-project 7).

## Sub-project 4: Web Push Upgrades

### Schema

`PushSubscription.userId` added (above). Migration backfills existing rows with `userId = null` initially; the worker treats `userId = null` as "broadcast to all subscribers" until a deprecation window ends. A separate migration run 30 days after launch sets all `userId = null` rows to inactive.

### Delivery rules

- New feed item arrives in worker.
- Look up users following the tweet's project.
- For each such user, check their filters + mutes (same rules as Sub-project 2).
- If the item passes the user's filters, fan out push to that user's subscriptions.
- Users with no follows AND no filters receive all items (back-compat).

### `PushDispatcher`

New service `src/services/push-dispatcher.ts`:

```
class PushDispatcher {
  dispatchToFollowers(item: FeedItem): Promise<void>
  dispatchToUser(userId: string, item: FeedItem): Promise<DispatchResult>
}
```

- **Retry:** exponential backoff with jitter, max 3 attempts. On 404/410 → delete subscription row.
- **VAPID rotation:** env supports `VAPID_SUBJECT`, `VAPID_PUBLIC_KEY_NEW`, `VAPID_PRIVATE_KEY_NEW`. When new keys are present, push with new key set; include `applicationServerKey` in `subscribe()` payload so service workers register against the new key. Old keys remain valid for 30 days.
- **Health:** `/admin/health/push` reports delivery counts, failure counts, dead-sub count.

### Acceptance criteria

- New feed item → push delivered only to users following the project.
- Filtered-out item → push NOT delivered.
- Dead subscription auto-pruned.
- Admin can rotate VAPID keys without downtime.

## Sub-project 5: Telegram Bot Upgrades

### Commands

| Command | Purpose |
|---|---|
| `/start` | Welcome + auth hint |
| `/link <token>` | Bind chat_id to a User via an invite/login token |
| `/whoami` | Show bound User email |
| `/follow <username>` | Add to viewer's follows |
| `/unfollow <username>` | Remove from viewer's follows |
| `/mute <keyword>` | Add to viewer's mute list |
| `/unmute <keyword>` | Remove |
| `/feed [n]` | DM the viewer their last N filtered feed items |
| `/filters` | List filters |

### `TelegramBot` integration

Existing `src/tgBot/` is extended. The bot reads `chat_id → user_id` mapping from a new table `TelegramBinding`:

```
model TelegramBinding {
  chatId    BigInt   @id @map("chat_id")
  userId    String   @map("user_id")
  createdAt DateTime @default(now()) @map("created_at")

  @@index([userId])
  @@map("telegram_bindings")
}
```

DM delivery uses the same filter evaluation as Sub-project 2.

### Acceptance criteria

- A user can `/link` their Telegram chat.
- `/feed` returns only items that pass the user's filters and follow list.
- Unlinked chat can still use `/start` but cannot pull personalized data.

## Sub-project 6: Feed UI + Service Worker

### UI changes

- `webui/components/feed-item-card.tsx` (existing, currently in M) gains `useUser()` hook → renders Login or Logout button.
- New `webui/app/login/page.tsx` — email + password form.
- New `webui/app/invite/[token]/page.tsx` — accept-invite flow.
- New `webui/app/settings/filters/page.tsx` — filter & mute management.
- New `webui/components/post-actions.tsx` — Like / Reply / Retweet / Post buttons.
- `webui/app/page.tsx` feed query gains `?filter=mine` for logged-in viewers.

### Service worker changes

`webui/public/sw.js` (existing):

- Cache strategy: stale-while-revalidate for `/feed`, network-first for `/auth/me` and `/filters`.
- Offline cache: last 50 feed items per viewer.
- Push handler gains `data.url` — clicking the notification opens the tweet URL on X.
- Notification `tag` includes projectId + tweetId for dedup.

### Acceptance criteria

- Logged-out viewer sees a read-only public feed (back-compat).
- Logged-in viewer sees a personalized feed, can like/reply/retweet.
- App works offline for the last 50 cached items.
- Push notifications from a project's tweet open the tweet on click.

## Sub-project 7: Twitter/X Client Upgrades

### `TwitterClient` enhancements

The existing client in `src/TwitterClient/` gains:

- **Per-account circuit breaker** — when 3 consecutive 429s or 5xx, mark account as `degraded`. Polling skips degraded accounts for 15 minutes (linear backoff).
- **Exponential backoff with jitter** — 1s, 2s, 4s, 8s, 16s, 32s with ±25% jitter.
- **Health surface** — `/admin/health/twitter` returns per-account: lastSuccessAt, lastErrorAt, consecutiveFailures, circuitState.
- **Polling backoff for inactive accounts** — accounts with no new tweets in 7 days polled at 1/4 frequency.

### Acceptance criteria

- 429 from X no longer crashes the worker; backoff prevents further calls until window resets.
- A truly dead account surfaces in `/admin/health/twitter` rather than silently failing.
- No regressions on happy-path polling.

## Cross-cutting concerns

### Data flow

```
feed worker → new FeedItem
   ↓
   for each user following item.projectId:
       apply user's Filter (keep/hide rules) + MuteKeyword
       if item passes:
           PushDispatcher.dispatchToUser(userId, item)
           io.to(`user:${userId}`).emit('feed:new', item)
```

### Error handling

| Failure | Handling |
|---|---|
| X 429 | Backoff with jitter, circuit breaker per account |
| X 5xx | Backoff, mark account degraded |
| X auth expired | Surface to admin via `/admin/health/twitter` |
| Push 404/410 | Prune subscription row |
| Push 5xx | Retry up to 3 times |
| Telegram 429 | Pause bot command handler for 30s |
| DB transient | Existing Prisma retry pattern |
| Worker crash | Existing restart policy — no change |

### Testing

| Layer | Coverage |
|---|---|
| Unit | filter evaluation, mute regex, auth flows (invite → accept → login → session), password hashing, XWriteClient mapping |
| Integration | feed worker → push delivery, feed worker → socket.io, Telegram `/feed` command |
| Manual E2E | invite flow, login, post interaction, push delivery, offline mode |

### Migration plan

Migrations are additive and ordered:

1. `add_user_user_session_user_invite` — new tables
2. `add_user_follow_filter_mute_keyword` — new tables
3. `add_push_subscription_user_id` — nullable column
4. `add_xauthtoken_user_id` — nullable column
5. `add_telegram_binding` — new table
6. *(30 days later, separate ticket)* `deactivate_anonymous_push_subs`

Each migration has a corresponding down migration that drops only the new tables/columns.

### Review focus

These are inputs/scenarios the spec implies but no task's tests exercise explicitly:

1. **Empty follows list** — viewer with zero follows sees every project's tweets (back-compat). Test: new user immediately after invite, before any follow.
2. **Filter + mute interaction** — when both match, hide wins. Test: filter.hide on project AND mute keyword both present in same tweet.
3. **Concurrent session refresh** — two parallel requests near session expiry must not double-issue tokens. Test: integration test fires 10 parallel `requireUser` against same session row.
4. **Push backpressure** — a tweet from a project followed by 10k users should not stall the worker. Test: integration with 1k synthetic users, measure fan-out latency.
5. **XWriteClient circuit breaker** — write failures must not cascade across accounts. Test: integration with one bad + one good token, confirm only the bad trips.

## Open questions

None at this time. All architectural decisions resolved during brainstorming.