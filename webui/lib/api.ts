import type {
  AuthToken,
  AuthTokenInput,
  FeedItem,
  Keyword,
  KeywordInput,
  Project,
  ProjectInput,
  WebhookInfo,
} from "@/lib/types";

export const SOCKET_URL =
  process.env.NEXT_PUBLIC_SOCKET_URL ?? "http://localhost:5500";

// Admin routes are gated by the backend's x-admin-token, not the session.
// The token is entered once per browser and kept in localStorage — requests
// still go through the same-origin /api proxy.
const ADMIN_TOKEN_KEY = "xfeed_admin_token";

export function getAdminToken(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(ADMIN_TOKEN_KEY) ?? "";
}

export function setAdminToken(token: string): void {
  if (typeof window === "undefined") return;
  if (token) window.localStorage.setItem(ADMIN_TOKEN_KEY, token);
  else window.localStorage.removeItem(ADMIN_TOKEN_KEY);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new Error(
      `API at /api${path} did not return JSON. Is the x-feed backend running on ${SOCKET_URL}?`,
    );
  }
  const data = (await response.json().catch(() => ({}))) as T & {
    error?: string;
  };
  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status})`);
  }
  return data;
}

export async function fetchProjects() {
  const data = await request<{ projects?: Project[] }>("/projects");
  return { projects: Array.isArray(data.projects) ? data.projects : [] };
}

export function fetchProject(userId: string) {
  return request<{ project: Project }>(`/projects/${userId}`);
}

export function createProject(input: ProjectInput) {
  return request<{ project: Project }>("/projects", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateProject(userId: string, input: ProjectInput) {
  return request<{ project: Project }>(`/projects/${userId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function deleteProject(userId: string) {
  return request<{ deleted: boolean; userId: string }>(`/projects/${userId}`, {
    method: "DELETE",
  });
}

export function deleteProjects(userIds: string[]) {
  return request<{ deleted: number; userIds: string[] }>("/projects/bulk-delete", {
    method: "POST",
    body: JSON.stringify({ userIds }),
  });
}

export async function fetchFeed(
  options: {
    limit?: number;
    offset?: number;
    matched?: boolean;
    filter?: "mine";
  } = {},
) {
  const limit = options.limit ?? 20;
  const params = new URLSearchParams({ limit: String(limit) });
  if (options.offset) params.set("offset", String(options.offset));
  if (options.matched) params.set("matched", "1");
  if (options.filter) params.set("filter", options.filter);
  const data = await request<{ items?: FeedItem[]; hasMore?: boolean }>(
    `/feed?${params}`,
  );
  return {
    items: Array.isArray(data.items) ? data.items : [],
    hasMore: data.hasMore === true,
  };
}

export function deleteFeedItem(id: string) {
  return request<{ deleted: boolean; id: string }>(`/feed/${id}`, {
    method: "DELETE",
  });
}

export async function fetchAuthTokens() {
  const data = await request<{ tokens?: AuthToken[] }>("/auth-tokens");
  return { tokens: Array.isArray(data.tokens) ? data.tokens : [] };
}

export function createAuthToken(input: AuthTokenInput) {
  return request<{ token: AuthToken }>("/auth-tokens", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateAuthToken(id: string, input: AuthTokenInput) {
  return request<{ token: AuthToken }>(`/auth-tokens/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function deleteAuthToken(id: string) {
  return request<{ deleted: boolean; id: string }>(`/auth-tokens/${id}`, {
    method: "DELETE",
  });
}

export function fetchWebhookInfo() {
  return request<WebhookInfo>("/webhooks");
}

export function sendWebhookProject(input: ProjectInput, secret?: string) {
  return request<{ project: Project }>("/webhooks/projects", {
    method: "POST",
    headers: secret ? { "X-Webhook-Secret": secret } : {},
    body: JSON.stringify(input),
  });
}

// ── Filters / mutes ──────────────────────────────────────────────────────

export type Filter = {
  id: string;
  name: string;
  kind: "project" | "keyword";
  projectId?: string | null;
  pattern?: string | null;
  action: "keep" | "hide";
  isActive: boolean;
};

export type Mute = {
  id: string;
  pattern: string;
  isRegex: boolean;
};

export async function fetchFilters(): Promise<Filter[]> {
  return request<Filter[]>("/filters");
}

export type FilterInput = {
  name: string;
  kind: "project" | "keyword";
  action: "keep" | "hide";
  pattern?: string;
  projectId?: string;
};

export async function createFilter(input: FilterInput): Promise<Filter> {
  return request<Filter>("/filters", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function deleteFilter(id: string): Promise<void> {
  await request<void>(`/filters/${id}`, { method: "DELETE" });
}

export async function fetchMutes(): Promise<Mute[]> {
  return request<Mute[]>("/mute-keywords");
}

export type MuteInput = { pattern: string; isRegex?: boolean };

export async function createMute(input: MuteInput): Promise<Mute> {
  return request<Mute>("/mute-keywords", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function deleteMute(id: string): Promise<void> {
  await request<void>(`/mute-keywords/${id}`, { method: "DELETE" });
}

// ── Post actions ─────────────────────────────────────────────────────────

export type WriteResult =
  | { ok: true; tweetId: string; url: string }
  | { ok: false; error: string; message?: string };

export async function likeTweet(id: string): Promise<WriteResult> {
  return request<WriteResult>(`/post/${id}/like`, { method: "POST" });
}

export async function retweetTweet(id: string): Promise<WriteResult> {
  return request<WriteResult>(`/post/${id}/retweet`, { method: "POST" });
}

export async function replyToTweet(
  id: string,
  text: string,
): Promise<WriteResult> {
  return request<WriteResult>(`/post/${id}/reply`, {
    method: "POST",
    body: JSON.stringify({ text }),
  });
}

export async function postTweet(text: string): Promise<WriteResult> {
  return request<WriteResult>("/post", {
    method: "POST",
    body: JSON.stringify({ text }),
  });
}

// ── Auth ──────────────────────────────────────────────────────────────────

export type AuthUser = {
  id: string;
  email: string;
  displayName: string | null;
};

export async function login(email: string, password: string): Promise<void> {
  await request<void>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export async function logout(): Promise<void> {
  await request<void>("/auth/logout", { method: "POST" });
}

export async function acceptInvite(
  token: string,
  password: string,
  displayName?: string,
): Promise<void> {
  await request<void>("/auth/accept-invite", {
    method: "POST",
    body: JSON.stringify({ token, password, displayName }),
  });
}

/**
 * Returns the logged-in user, or `null` if the session is anonymous. Other
 * server errors are thrown — callers that want a "logged-out" view should
 * treat any thrown error as anonymous after retrying once.
 */
export async function fetchMe(): Promise<AuthUser | null> {
  const response = await fetch(`/api/auth/me`, { credentials: "include" });
  if (response.status === 401) return null;
  if (!response.ok) {
    throw new Error(`Auth check failed (${response.status})`);
  }
  return (await response.json()) as AuthUser;
}

// ── Growth ────────────────────────────────────────────────────────────────

export type GrowthChange = {
  /** username | name | bio | avatar | location | verified | status */
  field: string;
  oldValue: string | null;
  newValue: string | null;
  changedAt: string;
};

export type GrowthLatestTweet = {
  id: string;
  text: string;
  tweetUrl: string;
  postedAt: string;
  likes: number;
  reposts: number;
  replies: number;
};

export type GrowthUser = {
  userId: string;
  username: string;
  twitterName: string | null;
  twitterBio: string | null;
  location: string | null;
  isBlueVerified: boolean;
  followers: number;
  following: number;
  tweets: number;
  description: string | null;
  website: string | null;
  github: string | null;
  chain: string | null;
  tokenAddress: string | null;
  profileImageUrl: string | null;
  status: string;
  statusReason: string | null;
  statusChangedAt: string | null;
  lastSeenAt: string | null;
  missedChecks: number;
  lastFetchedAt: string | null;
  /**
   * Net change from the newest snapshot at or before the selected window's
   * start. Always a number; `0` means no pre-window baseline or no movement.
   */
  followersDelta: number;
  followingDelta: number;
  tweetsDelta: number;
  changes: GrowthChange[];
  tweetsInWindow: number;
  latestTweet: GrowthLatestTweet | null;
};

export type GrowthRange = "1h" | "12h" | "24h" | "7d" | "all";

export type GrowthResponse = {
  range: GrowthRange;
  /** Lower bound of the window. `undefined` when `range = "all"`. */
  since: string | undefined;
  generatedAt: string;
  count: number;
  users: GrowthUser[];
};

export async function fetchGrowth(params: {
  range?: GrowthRange;
  sortBy?: "userId" | "growth";
  sortOrder?: "asc" | "desc";
  userId?: string;
}) {
  const q = new URLSearchParams();
  if (params.range) q.set("range", params.range);
  if (params.sortBy) q.set("sortBy", params.sortBy);
  if (params.sortOrder) q.set("sortOrder", params.sortOrder);
  if (params.userId) q.set("userId", params.userId);
  return request<GrowthResponse>(`/growth?${q.toString()}`);
}

export type TrendRange = "24h" | "7d" | "30d";

export type TrendPoint = {
  t: string;
  followers: number;
  following: number;
  tweets: number;
};

export type TrendResponse = {
  userId: string;
  range: TrendRange;
  points: TrendPoint[];
};

export function fetchTrend(userId: string, range: TrendRange) {
  const q = new URLSearchParams({ userId, range });
  return request<TrendResponse>(`/growth/trend?${q.toString()}`);
}

// ── Admin (x-admin-token gated) ───────────────────────────────────────────

export type Invite = {
  id: string;
  invitedById: string;
  email: string | null;
  createdAt: string;
  expiresAt: string;
};

export type CreatedInvite = {
  id: string;
  /** Shown once — the backend only stores its hash. */
  token: string;
  expiresAt: string;
};

export type AdminTwitterHealth = {
  accounts: Array<{ username: string; linkedToUser: boolean }>;
};

export type AdminPushHealth = {
  total: number;
  withUser: number;
};

async function adminRequest<T>(path: string, init?: RequestInit): Promise<T> {
  return request<T>(path, {
    ...init,
    headers: { "x-admin-token": getAdminToken(), ...init?.headers },
  });
}

export async function fetchInvites(): Promise<Invite[]> {
  const data = await adminRequest<{ invites?: Invite[] } | Invite[]>(
    "/admin/users/invites",
  );
  return Array.isArray(data) ? data : (data.invites ?? []);
}

export function createInvite(input: {
  invitedById: string;
  email?: string;
}): Promise<CreatedInvite> {
  return adminRequest<CreatedInvite>("/admin/users/invites", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

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

export async function deleteInvite(id: string): Promise<void> {
  await adminRequest<{ ok: boolean }>(`/admin/users/invites/${id}`, {
    method: "DELETE",
  });
}

export async function fetchAdminTwitterHealth(): Promise<AdminTwitterHealth> {
  return adminRequest<AdminTwitterHealth>("/admin/health/twitter");
}

export async function fetchAdminPushHealth(): Promise<AdminPushHealth> {
  return adminRequest<AdminPushHealth>("/admin/health/push");
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
